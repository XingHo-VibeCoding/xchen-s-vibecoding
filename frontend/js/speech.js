/* speech.js —— 录音上传（你说的话）+ AI 朗读（AI 出声）
   =============================================================
   Day 23 新建。★ **中途换过一次实现方案**，原因记在这里——
   留着是为了下次别再走一遍。

   -------------------------------------------------------------
   一、★ 为什么从「浏览器识别」换成「录音上传」
   -------------------------------------------------------------
   初版用浏览器原生 `SpeechRecognition`（`TECH_DESIGN.md:139` 当初的 v1 选型）。
   真机一试就报 `network` —— **Chrome 的语音识别不是本地识别**：
   它把录音上传到 Google 的服务器去识别，国内网络访问不通就一直等。

   ★ 这不是「浏览器不支持」，是「这条路在我们的网络环境下走不通」，
     继续调参数不会有任何改变。
   ★ 而 `TECH_DESIGN.md:107` 早就写明了这条（「Chrome 上还依赖网络」），
     `:139` 也留了后路（「是否切换由 Day 6 实测决定（Q-T1）」），
     `docs/api-contract.md §5` 更把 `POST /api/speech-to-text` 的位置预留好了，
     标注「v1 不启用，R1 触发时不用回头改接口设计」。
     ★ **现在就是那个触发时。** 转写改由腾讯云一句话识别（云函数 speech）。

   —— 但**朗读没有换**：AI 出声继续用 `SpeechSynthesis`，
     它是**真本地**（用操作系统语音），不需要网络，所以那条路一直是对的。

   -------------------------------------------------------------
   二、录音与识别的分工
   -------------------------------------------------------------
     录音：MediaRecorder（浏览器原生，本地）
     识别：录音 → POST /api/speech-to-text → 腾讯云一句话识别

   ★ 为什么录完一整句才传（不是流式）：
     一句英语约 1–3 秒音频，流式要处理分片、断线重传、顺序保证，
     而收益只是省 1–2 秒。对练口语这个场景不值当。

   ★ 静音判定现在是**纯前端音量检测**：
     浏览器不再返回 interim，所以「你在不在说话」只能靠音量判断。
     —— 这反而解决了一个老问题：「光标在框里没打字」在语音形态下
        本来就不存在，因为语音形态下根本没有「框」。

   ★★ **一个必须如实告知用户的隐私代价**（与选型无关，是事实）：
     音频**会离开设备**，发给腾讯云。不落库、不留存，
     只用于一次识别请求。
     选浏览器方案当初就是为了避免这件事，现在触发退路就得接受它。

   -------------------------------------------------------------
   三、格式：腾讯云不收 webm（实测踩过）
   -------------------------------------------------------------
     `MediaRecorder` 默认给 `audio/webm;codecs=opus`，**腾讯云不收**。
     Chrome 可以指定 `audio/mp4`，Safari 默认就是 m4a。
     所以按 mp4 → wav 的顺序探测，都不行才用浏览器默认。
   ============================================================= */

(function (global) {
  'use strict';

  /* ---------- 能力探测 ----------
     ★ 判定标准从「有没有 SpeechRecognition」改成
       「有没有 MediaRecorder + 能不能拿到麦克风」——
       前者是**识别**能力，而我们已经不依赖浏览器识别了。 */
  function canRecord() {
    return !!(global.MediaRecorder && global.navigator &&
              navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  /* ---------- 参数（每个都有理由，不是随手填的） ---------- */

  /* 连续静音多久算「你说完了」（毫秒）。
     ★ 2026-10-26 两轮调整，最终定 3.5 秒：
       ① 原值 2.5 秒 → 用户报「句子讲完只录到两个单词」：
          目标用户是「一开口就卡住的人」，说到一半停下想词 3 秒太常见，
          2.5 秒就判他"说完了"，后半句根本没进去。
       ② 先拉到 5 秒 → 用户立刻报「反应太慢，说完还要等好一会」。
          实测等待 = 静音 + 识别，识别只占 1 秒，剩下全是这里。
       ③ 折中 3.5 秒。★ 为什么 3.5 能同时成立：
          「说完了」不再只靠这一个判据 —— 用户点「我说完了」会**立刻**收尾
          （见 dialogue.html 的 submit 处理：空框 + 录音中 = 催识别并自动提交）。
          所以想快的人点一下，1 秒就出字；卡壳的人不用点，3.5 秒兜底。
       3.5 秒 ≈ 英语换气/思考的上限，再短就回到误截断。 */
  var SILENCE_END_MS = 3500;

  /* 音量阈值：低于这个值算「没在说」。
     ★ 为什么不是 0：环境噪音、空调、键盘声都会让音量不为零，
       用 0 会导致永远不结束录音。
     ★ 0.02 是起步值（0–1 归一化）。麦克风灵敏度差异大，
       觉得灵敏就调高、觉得迟钝就调低。 */
  var VOLUME_THRESHOLD = 0.02;

  /* 判定「有人在说」要连续几帧为真 —— 消抖，不是延迟
     （一帧爆音不足以判定为说话）。 */
  var VOICE_FRAMES = 3;

  /* 最长录音：防止一直占着麦克风。 */
  var MAX_RECORD_MS = 30000;

  /* ★★★ 2026-10-26：自适应的音量阈值 + 硬兜底。
     起因：iPhone 在**微信里**打开这个网址，音量条明明在动，
     状态却永远停在「正在听……」不结束 —— 也就是永远判不出「说完了」。

     根因：阈值写死 0.02，而手机麦克风（尤其微信内置内核 + AGC 自动增益）
     有持续底噪，音量一直高于 0.02 → `quietMs` 每帧都被归零 → 永远等不到静音。
     桌面 Chrome 的麦克风干净得多，所以这个坑只在手机上炸。

     改法：
       ① 开机先量 NOISE_CALIB_MS 的环境底噪，阈值取「底噪 × NOISE_RATIO」，
          夹在 [VOLUME_THRESHOLD, THRESHOLD_MAX] 之间 —— 每台设备用自己的尺子。
       ② FORCE_STOP_MS 硬兜底：这么久还没判出「说完了」，强制切一段送去识别。
          宁可多切一刀，也不能让人对着「正在听」干等 —— 任何阈值都可能失灵，
          但「永远卡住」是不能接受的失败方式。 */
  var NOISE_CALIB_MS = 600;      /* 标定底噪的时长 */
  var NOISE_RATIO = 2.2;         /* 阈值 = 底噪 × 这个倍数 */
  var THRESHOLD_MAX = 0.12;      /* 上限：再高就听不见正常说话了 */
  var FORCE_STOP_MS = 15000;     /* 硬兜底，15 秒必切一刀 */

  /* 朗读速度。1.0 是默认，0.95 略慢一点点。
     ★ 为什么不要更慢（如 0.8）：PRD §6.6 要求「不主动降语速」。
       这个产品的前提是「你听得懂但说不出来」，
       AI 放慢就是在替用户降低难度 —— 那是另一个产品。 */
  var SPEECH_RATE = 0.95;
  var SPEECH_PITCH = 1.0;

  /* ---------- 状态 ---------- */
  var stream = null;        /* getUserMedia 拿到的音频流 */
  var recorder = null;      /* MediaRecorder 实例 */
  var chunks = [];          /* 录音片段 */
  var audioCtx = null;      /* AudioContext，做音量分析 */
  var analyser = null;
  var rafId = null;         /* 音量检测的动画帧 */
  var lastTs = 0;           /* 上一帧的时间戳，用来算「真实过了多少毫秒」 */
  var voiceFrames = 0;      /* 连续「有声音」的帧数 */
  var quietMs = 0;          /* 已经静音多久 */
  var spoke = false;        /* 这一轮里说过话没有（决定能否靠静音收尾） */

  /* ★ 2026-10-26：底噪标定与自适应阈值（理由见上面 NOISE_CALIB_MS 那段） */
  var noiseSum = 0;         /* 标定期间的音量累加 */
  var noiseSamples = 0;     /* 标定期间的帧数 */
  var noiseDone = false;    /* 标定完了没有 */
  var effThreshold = VOLUME_THRESHOLD;  /* 这一次录音实际用的阈值 */
  var recordStartTs = 0;    /* 标定结束的时刻，硬兜底从这里开始算 */
  var speaking = false;     /* AI 是否正在朗读 */
  var recording = false;    /* 是否正在录 */
  /* ★ 2026-10-26：这一轮是「静音收尾」还是「用户主动停」。
     静音收尾要**立刻重新开录**（见 finishRecording）——
     否则上传识别那 1–3 秒里麦克风是关的，用户接着说的一句话会凭空消失。
     这正是「只能说两个词」的另一半原因：前两个词录到了，
     停顿后的后半句正好落在识别窗口里，全丢。 */
  var autoRestartPending = false;
  var timerId = null;       /* 最长录音计时器 */
  var token = 0;            /* 每轮录音的代号（2026-10-26 起不再用于丢弃识别结果，
                               改用 sessionGen —— 连续分段时 token 每段都变，
                               会把上一段在途的结果误判成过期） */
  var sessionGen = 0;       /* 整场会话代号：只有用户主动结束对话才作废在途识别 */
  var buf = null;           /* 音量采样缓冲，依赖 analyser.fftSize，建ctx 时才 new */

  /* ---------- 事件回调（由 dialogue.html 注入） ----------
     为什么用注入而不是直接改 DOM/调用页面函数：
     TECH_DESIGN §4.2 规矩 1/2 —— storage.js 是本地存储唯一出口、
     api.js 是后端唯一出口，页面逻辑归页面。这个文件只管语音。 */
  var hooks = {
    onVolume: function () {},     /* 音量变化 */
    onResult: function () {},     /* 转写完成 */
    onEmpty: function () {},      /* 没听清 */
    onError: function () {},      /* 出错了 */
    onStateChange: function () {} /* 录音态变化 */
  };

  /* ---------- 权限 ---------- */
  function micPermission() {
    if (!global.navigator || !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia) {
      return Promise.resolve('unknown');
    }
    return navigator.mediaDevices.getUserMedia({ audio: true })
      .then(function (s) {
        if (s && s.getTracks) s.getTracks().forEach(function (t) { t.stop(); });
        return 'granted';
      })
      .catch(function (err) {
        return (err && err.name === 'NotAllowedError') ? 'denied' : 'error';
      });
  }

  /* ---------- 挑格式 ---------- */
  /* ★ 顺序有意为之：mp4 优先（Safari 原生、Chrome 可指定、体积小），
     wav 兜底（兼容最好但体积大）。
     ★ 注意不要放 webm：腾讯云不收它，放进去等于白跑一趟。 */
  function pickMimeType() {
    var list = ['audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/wav'];
    for (var i = 0; i < list.length; i++) {
      try {
        if (global.MediaRecorder && MediaRecorder.isTypeSupport &&
            !MediaRecorder.isTypeSupport) {
          /* 老浏览器没有 isTypeSupported：直接用第一个试 */
          return list[0];
        }
        if (MediaRecorder.isTypeSupported &&
            MediaRecorder.isTypeSupported(list[i])) {
          return list[i];
        }
      } catch (e) { /* 探测抛错就跳过这个 */ }
    }
    return '';
  }

  /* ---------- 录音：开始 ---------- */
  function startRecording() {
    if (!canRecord()) return Promise.resolve('unsupported');
    if (recording) return Promise.resolve('already');
    /* ★★ Day 24 修（界面与服务端对不上的一处）：AI 正在朗读时不开麦。
       dialogue.html 一直按这个返回值在处理 —— 它明确把 'busy-speaking'
       排除在「需要降级」之外（见那里的 startListening().then(...)），
       但这里**从来没写过这条判断**，那条防护一直是空的。

       ★ 为什么必须挡：浏览器没有回声消除，AI 外放的声音会被麦克风
         拾到、当成用户说的话（理由同文件顶部「为什么不做一开口就打断」）。
       ★ 不会把对话卡住：朗读结束时 speakAiLine 那一侧会再调一次
         startListening，所以这里挡掉只是「等它说完」，不是「不听了」。 */
    if (speaking) return Promise.resolve('busy-speaking');

    return micPermission().then(function (perm) {
      /* ★ 权限失败要说出来 —— 静默返回是最贵的错误：
         用户只看到「点了没反应」，跟不支持语音长得一模一样。 */
      if (perm === 'denied' || perm === 'error') {
        hooks.onError(perm === 'denied' ? 'not-allowed' : 'audio-capture');
        return perm === 'denied' ? 'denied' : 'error';
      }

      var myToken = ++token;
      return navigator.mediaDevices.getUserMedia({ audio: true })
        .then(function (s) {
          /* ★ 拿到流就把要设的回调挂上去 —— 必须在 start() 之前，
             否则用户可能已经开口了而我们还在等事件。 */
          stream = s;
          chunks = [];
          spoke = false;
          voiceFrames = 0;
          quietMs = 0;
          lastTs = 0;
          /* ★ 2026-10-26：每一轮录音都重新标定底噪 —— 换设备、换房间、
             或者用户刚好在噪音变大的时候重开，都要按当时的环境来。 */
          noiseSum = 0;
          noiseSamples = 0;
          noiseDone = false;
          effThreshold = VOLUME_THRESHOLD;
          recordStartTs = 0;
          hooks.onStateChange('recording');
          startVolumeWatch();
          clearTimeout(timerId);
          timerId = setTimeout(function () {
            /* 到上限就当说完 —— 不让人一直占着麦克风 */
            if (recording) stopRecording();
          }, MAX_RECORD_MS);
          return 'ok';
        })
        .catch(function (err) {
          release();
          hooks.onError((err && err.name) === 'NotAllowedError'
            ? 'not-allowed' : 'mic-failed');
          return 'failed';
        });
    });
  }

  /* ---------- 录音：停止 ---------- */
  function stopRecording() {
    if (!recorder) {
      /* 还没start（极端情况：权限过了但构造失败）→ 直接走收尾 */
      finishRecording();
      return;
    }
    try {
      if (recorder.state !== 'inactive') recorder.stop();
      else finishRecording();
    } catch (e) {
      finishRecording();
    }
  }

  function release() {
    stopVolumeWatch();
    clearTimeout(timerId);
    recording = false;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
    }
    recorder = null;
    if (stream && stream.getTracks) {
      stream.getTracks().forEach(function (t) { t.stop(); });
    }
    stream = null;
    if (audioCtx) {
      try { audioCtx.close(); } catch (e) { /* 关不掉就算了 */ }
      audioCtx = null;
    }
    analyser = null;
  }

  /* ---------- 音量检测（代替浏览器的 interim 结果） ---------- */
  /* ★ 为什么必须自己做：换成服务端识别后浏览器不再返回中间结果，
     「你在不在说话」只能靠音量。没有它就不知道何时结束录音。 */
  function startVolumeWatch() {
    stopVolumeWatch();
    try {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC || !stream) return;
      audioCtx = new AC();
      /* ★ 2026-10-26：iOS Safari 和微信内置内核会把它创建成 suspended，
         挂起时 getByteTimeDomainData 读出来恒为 0 —— 音量条不动、也永远判不出说完了。
         桌面 Chrome 默认就是 running，所以这一行在电脑上测不出来。
         （resume 是异步的，失败不抛出去：拿不到就退回原来的固定阈值。） */
      if (audioCtx.state === 'suspended' && audioCtx.resume) {
        try { audioCtx.resume(); } catch (e) { /* 老浏览器没有 resume */ }
      }
      var src = audioCtx.createMediaStreamSource(stream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      /* ★ buf 要在这里 new —— 它依赖 analyser.fftSize。
         放在模块顶层会拿到 null（var 提升只提升声明不提升赋值）。 */
      buf = new Uint8Array(analyser.fftSize);
      recording = true;    /* ★ 必须在建好音量检测后才置 true */
      recorder = makeRecorder();
      recorder.start();
      /* ★★★ Day 25 修（缺陷 1/2）：循环必须在这里**第一次启动**。
         之前 tickVolume 只在自己末尾用 requestAnimationFrame 给自己续帧，
         **没有任何地方第一次调用它** —— 于是这个循环从来没跑过：
         音量条不动、静音秒数永远不累计、「说完停一下自动提交」从未生效。
         录音就只能靠手动点「我说完了」或 30 秒上限结束 ——
         这正是用户报的「讲完了他还没输入」+「还在讲就被截断提交」。 */
      lastTs = 0;
      rafId = requestAnimationFrame(tickVolume);
    } catch (e) {
      /* 建不起来就退化成「只能手动停」——
         不因为音量检测失败就整个功能不可用。 */
      analyser = null;
      recording = true;
      recorder = makeRecorder();
      if (recorder) { try { recorder.start(); } catch (e2) {} }
    }
  }

  function makeRecorder() {
    try {
      var mime = pickMimeType();
      var r = mime ? new MediaRecorder(stream, { mimeType: mime })
                   : new MediaRecorder(stream);
      r.ondataavailable = function (ev) {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };
      r.onstop = function () { finishRecording(); };
      return r;
    } catch (e) {
      hooks.onError('recorder-init-failed');
      return null;
    }
  }

  function stopVolumeWatch() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function tickVolume(ts) {
    if (!recording || !analyser || !buf) return;
    analyser.getByteTimeDomainData(buf);
    /* ★ 算平均绝对偏差：时域信号围绕 128 摆动，
       偏离越大说明有人在说话。这比算 RMS 更容易设阈值。 */
    var sum = 0;
    for (var i = 0; i < buf.length; i++) {
      var d = buf[i] - 128;
      sum += d < 0 ? -d : d;
    }
    var level = sum / buf.length / 128;
    hooks.onVolume(level);

    /* ★★★ Day 25 修（缺陷 2/2）：算「这一帧离上一帧**真实过了多少毫秒**」。
       原来这一行是 `quietMs += FRAME_MS`，而 FRAME_MS 全项目没有定义 ——
       一旦执行到这里就抛 ReferenceError。而且它抛错的位置很毒：
       末尾那句 `rafId = requestAnimationFrame(tickVolume)` 会被跳过，
       循环从此静默停摆（不报给用户，只在 Console 里留一行）。

       ★ 为什么按时间戳差，而不是按「帧数 × 16.7」：
         rAF 的间隔不是恒定的 —— 切到后台标签页会被节流到约 1 次/秒，
         按帧数累加会把静音时长严重低估（要 150 帧才够 2.5 秒 → 实际拖到 150 秒）。
         用真实时间差则在 60fps 和 1fps 两种情况下都算得对。 */
    var dt = (lastTs && ts > lastTs) ? (ts - lastTs) : 0;
    lastTs = ts;
    if (!recordStartTs) recordStartTs = ts;

    /* ★ 2026-10-26：开机先量底噪，定出这台设备自己的阈值。
       标定期间既不判「在说话」也不累计静音 —— 否则手机底噪会被当成他开口了，
       一标完就立刻满足「说过话 + 静音」→ 秒收尾，录到一片空。 */
    if (!noiseDone) {
      noiseSum += level;
      noiseSamples++;
      if (noiseSamples >= 40) {          /* ≈ 0.6 秒（60fps） */
        var floor = noiseSum / noiseSamples;
        effThreshold = Math.min(THRESHOLD_MAX,
          Math.max(VOLUME_THRESHOLD, floor * NOISE_RATIO));
        noiseDone = true;
        recordStartTs = ts;              /* 硬兜底从标定结束才算 */
      }
      rafId = requestAnimationFrame(tickVolume);
      return;
    }

    /* ★ 硬兜底：15 秒还没判出「说完了」，说明音量判定失灵了
       （阈值高于底噪、或一直有持续声音盖着 —— 微信里就是这样）。
       强制切一段送去识别：宁可多切一刀，也不能让人对着「正在听」干等。 */
    if (ts - recordStartTs > FORCE_STOP_MS) {
      autoRestartPending = true;         /* 切完继续听，别把后面的话也堵死 */
      stopRecording();
      return;
    }

    if (level > effThreshold) {
      voiceFrames++;
      quietMs = 0;
      spoke = true;
    } else if (voiceFrames >= VOICE_FRAMES) {
      quietMs += dt;
      /* ★ 只有「已经说过话」之后才允许靠静音收尾。
         否则用户还没开口就因为环境安静被判为「说完」，
         得到一个空录音、弹一次「没听清」—— 纯属骚扰。 */
      if (spoke && quietMs >= SILENCE_END_MS) {
        /* ★ 标成「静音收尾」= 收完立刻重新开录，不等识别结果 */
        autoRestartPending = true;
        stopRecording();
        return;
      }
    } else {
      /* 消抖期内既不算说话也不累计静音 */
      quietMs = 0;
    }
    rafId = requestAnimationFrame(tickVolume);
  }


  /* ---------- 录音结束 → 上传识别 ---------- */
  function finishRecording() {
    /* ★ 2026-10-26：这三样必须在 release() 之前取 —— 它会把 recorder 置 null。
       原来 mime 在 release 之后取，永远拿到空，于是所有音频一律兜底成 audio/mp4，
       与浏览器实际录出来的 webm 对不上（服务端按 mp4 解析，识别质量受影响）。 */
    var hadVoice = spoke;
    var shouldRestart = autoRestartPending && hadVoice && chunks.length > 0;
    autoRestartPending = false;
    var mime = (recorder && recorder.mimeType) || '';

    release();

    if (!chunks.length) {
      if (shouldRestart) restartRecording();
      hooks.onEmpty();
      return;
    }
    var blob = new Blob(chunks, { type: mime || 'audio/mp4' });
    chunks = [];
    if (!blob.size) {
      if (shouldRestart) restartRecording();
      hooks.onEmpty();
      return;
    }

    /* ★ 上传前先告诉页面「正在识别」——
       否则用户看到的是「停住了，什么都没发生」，
       会以为又不灵了，于是重复说话 → 被当成两句。 */
    hooks.onStateChange('transcribing');

    /* ★★ 2026-10-26（三修之二）：**停的那一刻就重新开录，不等识别结果**。
       改之前是「识别回来再重启」（页面 onSpeechResult 里那句），
       中间隔着上传 + 腾讯云识别的 1–3 秒，这段麦克风是关的。
       用户停顿后被截断，接着说的后半句正好落在这段聋区里，
       于是框里只剩前两个词 —— 这就是「只录到两个单词」的另一半原因。
       ★ 为什么不会串账：重启前这一轮的 stream 已经 release，chunks 是新数组；
         识别结果回来时页面按「拼接」处理，两段按顺序接上。
       ★ 为什么放在 onStateChange('transcribing') 之后：让页面先知道"在识别"，
         再收到"又开始录了"，合成出「识别中，但你可以接着说」这一句。 */
    if (shouldRestart) restartRecording();

    if (!global.Api || !global.Api.speechToText) {
      hooks.onError('no-api');
      /* ★ 这条早退也必须在"识别中"计数上还一次，否则页面的
         「正在识别」永远挂着（页面按 transcribing / transcribed 配对计数）。 */
      hooks.onStateChange('transcribed');
      return;
    }
    /* ★★ 2026-10-26（三修之三）：这里原来用 `token`（每轮录音的代号）判断
       "结果是不是过期的"。现在录音会**连续分段**：一段在识别、下一段已经在录，
       而每次重启都会 ++token —— 于是前一段的识别结果回来时被判成"过期"直接丢掉，
       两段都成了「没听清」。把判据换成**整场会话**的代号：
       只有用户真的结束这场对话（stopListening）才作废在途结果。 */
    var myGen = sessionGen;
    global.Api.speechToText(blob).then(function (r) {
      if (myGen !== sessionGen) return;
      var text = (r && r.text) ? String(r.text).trim() : '';
      if (r && r.degraded && r.code) hooks.onError(r.code);
      if (!text) hooks.onEmpty();
      else hooks.onResult(text);
    }).catch(function (err) {
      if (myGen !== sessionGen) return;
      hooks.onError((err && err.code) || 'UNKNOWN');
    }).then(function () {
      /* ★ 2026-10-26：识别收尾必须回报一次，否则页面的「正在识别」永远挂着。
         因为录音在识别期间是继续的，页面不能靠「下一个 recording 事件」推断识别结束 ——
         那个事件在识别**开始之前**就已经到了。 */
      hooks.onStateChange('transcribed');
    });
  }

  /* 静音收尾后重新开录。失败不重试 —— 硬重试会形成死循环，
     等页面下一次触发（用户点开始说话 / 说完一轮）即可。 */
  function restartRecording() {
    startRecording().then(function (r) {
      if (r !== 'ok') { /* busy-speaking / 权限被收走等：什么都不做 */ }
    });
  }

  /* ---------- AI 朗读（B2 / E10） ----------
     ★ 这一段没有换方案：SpeechSynthesis 是**真本地**的
       （用操作系统语音），不需要网络，所以从一开始就是对的。 */
  var synth = global.speechSynthesis || null;

  function canSpeak() {
    return !!synth && typeof global.SpeechSynthesisUtterance === 'function';
  }

  /* ---------- Day 28：挑音色 ----------
     背景：Day 23 至今**一次都没调用过 getVoices()**，一直用浏览器默认音色。
     同一份代码在三个环境里拿到的嗓子完全不同：

       Edge 桌面   Microsoft Aria Online (Natural)   接近真人
       Chrome 桌面 Microsoft David / Zira            导航播报
       安卓 Chrome  系统 TTS                          中等

     也就是说"AI 讲话很人机"里有一大块根本不是提示词的问题，
     只是用 Chrome 打开了。这里挑一下就能白拿一个代际的改善。

     ★ getVoices() 的坑：Chrome 首次调用常常返回**空数组**，
       要等 voiceschanged 事件之后才有值。所以
         ① 模块加载时先调一次把它叫醒；
         ② **每次朗读前都挑**，不做一次性缓存 ——
            空列表时退回默认音色，等列表到了下一句自然就用上了。
     ★ 为什么按名字打分而不是按 localService：
       最好的那些（Natural / Google）恰恰是在线音色，
       按"本地优先"会把它们全排到最后。 */

  var badVoices = {};        /* 朗读报错过的音色，本页内不再选它 */
  var voiceLogged = false;

  function scoreVoice(v) {
    if (!v || !v.lang) return -1;
    var lang = String(v.lang).toLowerCase();
    if (lang.indexOf('en') !== 0) return -1;   /* 只要英语 */

    var name = String(v.name || '').toLowerCase();
    var s = 0;
    if (name.indexOf('natural') >= 0 || name.indexOf('neural') >= 0) s += 100;
    if (name.indexOf('google') >= 0) s += 80;
    if (/(samantha|aria|jenny|guy|ava|allison|serena|karen|moira|daniel)/.test(name)) s += 60;
    if (name.indexOf('online') >= 0) s += 10;

    if (lang === 'en-us') s += 30;
    else if (lang === 'en-gb') s += 20;
    else s += 10;

    /* 老 SAPI 音色（David / Zira / Mark / Hazel）名字平平无奇，
       光靠 en-US +30 会被排到前面去 —— 明确扣分，它们是机械感的本体。 */
    if (/(david|zira|mark|hazel|george)/.test(name) && s < 100) s -= 40;
    return s;
  }

  function listVoices() {
    if (!synth || typeof synth.getVoices !== 'function') return [];
    try { return synth.getVoices() || []; } catch (e) { return []; }
  }

  function pickVoice() {
    var all = listVoices();
    if (!all.length) return null;
    var best = null;
    var bestScore = 0;      /* >0 才算数：全都不合格时退回浏览器默认 */
    for (var i = 0; i < all.length; i++) {
      var v = all[i];
      var key = v.voiceURI || v.name;
      if (badVoices[key]) continue;
      var s = scoreVoice(v);
      if (s > bestScore) { bestScore = s; best = v; }
    }
    return best;
  }

  /* 音色档次，给界面用（"要不要提示换个浏览器"）。
     natural / google / online 都不提示；**generic 才提示**。
     ★ 不能拿 pickVoice() 的结果来判档：David / Zira 那种老音色会被打分扣到
       负数，pickVoice() 返回 null，判出来是 'none' —— 而那一档恰恰是
       最该提示的情况。所以这里独立扫一遍列表，只看"有没有更好的"。 */
  function voiceTier() {
    var all = listVoices();
    var best = 'none';
    for (var i = 0; i < all.length; i++) {
      var v = all[i] || {};
      var lang = String(v.lang || '').toLowerCase();
      if (lang.indexOf('en') !== 0) continue;
      var n = String(v.name || '').toLowerCase();
      if (n.indexOf('natural') >= 0 || n.indexOf('neural') >= 0) return 'natural';
      if (n.indexOf('google') >= 0) return 'google';
      if (n.indexOf('online') >= 0) { if (best === 'none') best = 'online'; continue; }
      if (best === 'none') best = 'generic';
    }
    return best;
  }

  function voiceName() {
    var v = pickVoice();
    return v ? String(v.name || '') : '';
  }

  function logVoiceOnce(v) {
    if (voiceLogged) return;
    voiceLogged = true;
    try {
      console.log('[speech] 朗读音色 = ' +
        (v ? (v.name + ' (' + v.lang + ')') : '浏览器默认（getVoices 还空着）'));
    } catch (e) { /* 日志失败不影响朗读 */ }
  }

  /* 把语音列表叫醒（Chrome 首调用返回空，触发后才会陆续填上）。 */
  if (synth) { try { listVoices(); } catch (e) {} }

  function speak(text, opts) {
    opts = opts || {};
    if (!canSpeak() || !text) return Promise.resolve(false);
    return speakOnce(String(text), opts, 0);
  }

  /* ★ Day 28：拆出 speakOnce 只为**换一把音色重试一次**。
     attempt 只允许 0 → 1：在线音色（Natural / Google）拿不到时
     （网络不通、语音包缺失）会立刻 onerror，那时换本地的再念一遍，
     比整句没声音好。但不做无限重试 —— 每次都是一次真实合成尝试。 */
  function speakOnce(text, opts, attempt) {
    var voice = pickVoice();
    var u = new global.SpeechSynthesisUtterance(text);
    /* ★ 先设 voice 再设 lang：部分实现里 lang 会把 voice 覆盖掉，
       顺序反了会出现"挑了 Aria，念出来还是 David"。 */
    if (voice) u.voice = voice;
    u.lang = voice ? voice.lang : ((opts.lang) || 'en-US');
    u.rate = SPEECH_RATE;
    u.pitch = SPEECH_PITCH;

    return new Promise(function (resolve) {
      var settled = false;
      function done(ok) {
        if (settled) return;
        settled = true;
        speaking = false;
        resolve(ok);
      }
      function retryOrFail() {
        if (voice && attempt === 0) {
          /* 记下坏音色，本页内不再选它；然后换一把重来。 */
          badVoices[voice.voiceURI || voice.name] = true;
          settled = true;                 /* 别让下面那个 capMs 再结一次 */
          speaking = false;
          resolve(speakOnce(text, opts, 1));
          return true;
        }
        return false;
      }

      u.onend = function () { done(true); };
      /* E10：朗读失败不阻塞对话，文字照常显示。
         这里保证 onend 一定会被调用 → Promise 一定要结掉，
         否则页面的「正在听」状态会永远卡住。 */
      u.onerror = function () {
        if (retryOrFail()) return;
        done(false);
      };
      speaking = true;
      try {
        synth.cancel();          /* 打断上一句，防止排队堆积 */
        synth.speak(u);
        logVoiceOnce(voice);
      } catch (e) {
        if (retryOrFail()) return;
        done(false);
      }
      /* 兜底：某些浏览器 onend 不触发（切标签页时尤其明显）。
         按字数估一个上限，宁可提前放行也不能卡死对话。 */
      var capMs = Math.min(20000, 2500 + text.split(/\s+/).length * 450);
      setTimeout(function () { done(true); }, capMs);
    });
  }

  /* 用户主动跳过朗读 —— 这是本实现里的「打断」方式。
     ★ 为什么不做「一开口就打断」：没有回声消除，
       外放的声音会被麦克风拾到，音量判定必然误判自己。 */
  function stopSpeaking() {
    if (synth) { try { synth.cancel(); } catch (e) {} }
    speaking = false;
  }

  /* ---------- 对外 ---------- */
  global.Speech = {
    /* supported 沿用旧名：页面里多处按它判断「能不能用语音」，
       改名会牵动所有调用点，而语义上「能不能录音」就是这里要的。 */
    supported: canRecord,
    canRecord: canRecord,
    canSpeak: canSpeak,
    startListening: startRecording,   /* 名字沿用，省得页面全改 */
    /* ★ 2026-10-26：停止录音**不再顺带作废在途识别**。
       暂停时用户可能刚说完一句、识别还在路上，那正是他要留的话 ——
       作废掉等于「一按暂停就丢一句」。 */
    stopListening: stopRecording,
    /* 真正结束这场对话（跳结果页 / 换主题）才作废在途识别，
       防止结果回填到已经结束的对话里。 */
    endSession: function () { sessionGen++; stopRecording(); },
    speak: speak,
    stopSpeaking: stopSpeaking,
    /* Day 28：给界面判断"要不要提示换个浏览器"用。
       voiceTier() 返回 natural / google / generic / none。 */
    voiceTier: voiceTier,
    voiceName: voiceName,
    isListening: function () { return recording; },
    isSpeaking: function () { return speaking; },
    /* 当前这一轮实际用的音量阈值（每台设备标定出来的不一样）。
       排查「说完不结束」时看它：如果接近 THRESHOLD_MAX，说明环境底噪很高。 */
    currentThreshold: function () { return effThreshold; },
    on: function (name, fn) {
      if (hooks[name] && typeof fn === 'function') hooks[name] = fn;
    },
    THRESHOLDS: { SILENCE_END_MS: SILENCE_END_MS, VOLUME: VOLUME_THRESHOLD }
  };
})(window);