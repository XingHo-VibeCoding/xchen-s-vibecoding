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
     ★ 定 2.5 秒：英语句间停顿典型值 0.5–1.5 秒，
       2.5 秒既能接住换气与思考，又不会让人干等。 */
  var SILENCE_END_MS = 2500;

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
  var speaking = false;     /* AI 是否正在朗读 */
  var recording = false;    /* 是否正在录 */
  var timerId = null;       /* 最长录音计时器 */
  var token = 0;            /* 每轮录音的代号，防止旧回调污染新一轮 */
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

    if (level > VOLUME_THRESHOLD) {
      voiceFrames++;
      quietMs = 0;
      spoke = true;
    } else if (voiceFrames >= VOICE_FRAMES) {
      quietMs += dt;
      /* ★ 只有「已经说过话」之后才允许靠静音收尾。
         否则用户还没开口就因为环境安静被判为「说完」，
         得到一个空录音、弹一次「没听清」—— 纯属骚扰。 */
      if (spoke && quietMs >= SILENCE_END_MS) {
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
    release();

    if (!chunks.length) {
      hooks.onEmpty();
      return;
    }
    var mime = (recorder && recorder.mimeType) || '';
    var blob = new Blob(chunks, { type: mime || 'audio/mp4' });
    chunks = [];
    if (!blob.size) {
      hooks.onEmpty();
      return;
    }

    /* ★ 上传前先告诉页面「正在识别」——
       否则用户看到的是「停住了，什么都没发生」，
       会以为又不灵了，于是重复说话 → 被当成两句。 */
    hooks.onStateChange('transcribing');

    if (!global.Api || !global.Api.speechToText) {
      hooks.onError('no-api');
      return;
    }
    var myToken = token;
    global.Api.speechToText(blob).then(function (r) {
      if (myToken !== token) return;
      var text = (r && r.text) ? String(r.text).trim() : '';
      if (r && r.degraded && r.code) hooks.onError(r.code);
      if (!text) hooks.onEmpty();
      else hooks.onResult(text);
    }).catch(function (err) {
      if (myToken !== token) return;
      hooks.onError((err && err.code) || 'UNKNOWN');
    });
  }

  /* ---------- AI 朗读（B2 / E10） ----------
     ★ 这一段没有换方案：SpeechSynthesis 是**真本地**的
       （用操作系统语音），不需要网络，所以从一开始就是对的。 */
  var synth = global.speechSynthesis || null;

  function canSpeak() {
    return !!synth && typeof global.SpeechSynthesisUtterance === 'function';
  }

  function speak(text, opts) {
    opts = opts || {};
    if (!canSpeak() || !text) return Promise.resolve(false);
    var u = new SpeechSynthesisUtterance(String(text));
    u.lang = (opts.lang) || 'en-US';
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
      u.onend = function () { done(true); };
      /* E10：朗读失败不阻塞对话，文字照常显示。
         这里保证 onend 一定会被调用 → Promise 一定要结掉，
         否则页面的「正在听」状态会永远卡住。 */
      u.onerror = function () { done(false); };
      speaking = true;
      try {
        synth.cancel();          /* 打断上一句，防止排队堆积 */
        synth.speak(u);
      } catch (e) {
        done(false);
      }
      /* 兜底：某些浏览器 onend 不触发（切标签页时尤其明显）。
         按字数估一个上限，宁可提前放行也不能卡死对话。 */
      var capMs = Math.min(20000, 2500 + String(text).split(/\s+/).length * 450);
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
    stopListening: stopRecording,
    speak: speak,
    stopSpeaking: stopSpeaking,
    isListening: function () { return recording; },
    isSpeaking: function () { return speaking; },
    on: function (name, fn) {
      if (hooks[name] && typeof fn === 'function') hooks[name] = fn;
    },
    THRESHOLDS: { SILENCE_END_MS: SILENCE_END_MS, VOLUME: VOLUME_THRESHOLD }
  };
})(window);