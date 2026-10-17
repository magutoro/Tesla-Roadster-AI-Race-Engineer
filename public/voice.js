// Owner: friend — one pending answer and one short radio acknowledgment, never a growing queue.
import { CONFIG } from "./config.js";

export function instantCallout(events, lang) {
  const ja = lang === "ja";
  if (events.includes("crash") || events.includes("flip")) {
    return { text: ja ? "衝突です。必要ならRでリセット。" : "Impact detected. Press R to reset if needed.", lang: lang };
  }
  const measured = {
    abs_active: ja ? "ABSが作動しています。ブレーキを滑らかに。" : "ABS is active. Ease into the brake smoothly.",
    traction_control: ja ? "トラクション制御が作動しています。アクセルを滑らかに。" : "Traction control is active. Feed in the throttle smoothly.",
    tires_hot: ja ? "シミュレーションのタイヤ温度が高いです。滑りを抑えましょう。" : "Simulated tire temperatures are high. Reduce sliding.",
    tires_cold: ja ? "タイヤが冷えています。徐々にペースを上げましょう。" : "Tires are cold. Build pace gradually.",
  };
  for (const event of events) if (measured[event]) return { text: measured[event], lang: lang };
  if (events.includes("tank_empty")) {
    return { text: ja ? "エアが空です。スラスターは使えません。" : "Air tank empty. Thrusters are unavailable.", lang: lang };
  }
  return null;
}

export class EngineerVoice {
  constructor(onQuestion, onStatus, onTranscript = function () {}) {
    this.enabled = false;
    this.handsFree = false;
    this.handsFreeError = "";
    this.lastListenAttempt = -Infinity;
    this.userSpeaking = false;
    this.lastSpeechEndedAt = -Infinity;
    this.voiceName = "";
    this.pending = null;
    this.acknowledgment = null;
    this.current = null;
    this.utterance = null;
    this.listening = false;
    this.stopping = false;
    this.cancelled = false;
    this.onStatus = onStatus;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.recognition = Recognition ? new Recognition() : null;
    if (this.recognition) {
      this.recognition.continuous = false; // Send one question automatically when the speaker finishes.
      this.recognition.interimResults = true;
      this.recognition.onspeechstart = function () {this.userSpeaking=true;}.bind(this);
      this.recognition.onspeechend = function () {this.userSpeaking=false;}.bind(this);
      this.recognition.onresult = function (event) {
        if (this.cancelled) return;
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) this.transcript += event.results[i][0].transcript + " ";
          else interim += event.results[i][0].transcript;
        }
        onTranscript((this.transcript + interim).trim());
      }.bind(this);
      this.recognition.onerror = function (event) {
        if (event.error === "aborted" && this.cancelled) return;
        this.transcript = "";
        this.cancelled = true;
        if (event.error !== "no-speech") {
          this.handsFree = false;
          this.handsFreeError = event.error;
        }
        const help = {
          "audio-capture": "No microphone audio is available. Check your Mac input device and microphone access for this app.",
          "not-allowed": "Microphone access was denied. Allow microphone access for this page and app, then try again.",
          "service-not-allowed": "Speech recognition is unavailable in this browser. Try the game in Chrome.",
          "network": "Speech recognition could not reach its service. Check your connection or try Chrome.",
          "no-speech": "I didn't hear a question. Click Talk and try again.",
        };
        onStatus((help[event.error] || "Microphone: " + event.error + ".") + " You can type your question.");
      }.bind(this);
      this.recognition.onend = function () {
        this.userSpeaking=false;
        this.listening = false;
        this.stopping = false;
        const text = (this.transcript || "").trim();
        this.transcript = "";
        if (this.cancelled) return;
        onStatus(text ? "Question captured." : "No speech detected. Try again.");
        if (text) onQuestion(text);
      }.bind(this);
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled && "speechSynthesis" in window;
    if (!this.enabled) this.clear();
    if (!this.enabled) { this.handsFree = false; this.stopListening(true); }
    return this.enabled;
  }

  setHandsFree(enabled) {
    this.handsFree = Boolean(enabled && this.enabled && this.recognition);
    this.handsFreeError = "";
    if(this.handsFree) this.lastSpeechEndedAt=performance.now();
    if (!this.handsFree) this.stopListening(true);
    return this.handsFree;
  }

  pollHandsFree(lang, blocked) {
    if(this.handsFree && blocked && this.listening && !this.userSpeaking) this.stopListening(true);
    if (!this.handsFree || blocked || this.listening || this.stopping || this.current || this.pending || this.acknowledgment) return;
    if (performance.now()-this.lastListenAttempt < CONFIG.coach.handsFreeRestartMs) return;
    this.lastListenAttempt=performance.now();
    if(!this.startListening(lang)) {this.handsFree=false;this.handsFreeError="audio-capture";}
  }

  clear() {
    this.pending = null;
    this.acknowledgment = null;
    this.current = null;
    this.utterance = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  queue(tip, urgent = false) {
    if (!this.enabled) return;
    const lifetime=tip.source === "guide-cue" ? CONFIG.coach.demoCueLifetimeMs : tip.source === "live" ? Math.max(0,CONFIG.liveCoaching.maximumAgeMs-(Date.now()-tip.capturedAt)) : CONFIG.coach.tipLifetimeMs;
    this.pending = { text: tip.text, lang: tip.lang, urgent: urgent, guided: tip.source === "guide" || tip.source === "guide-cue", expires: performance.now() + lifetime };
    if (urgent && "speechSynthesis" in window) {
      this.current = null;
      window.speechSynthesis.cancel();
    }
  }

  acknowledge(lang) {
    if (!this.enabled) return;
    this.acknowledgment = { text: lang === "ja" ? "了解。走行データを確認します。" : "Copy. Checking your driving data.",
      lang: lang, kind: "acknowledgment", expires: performance.now() + CONFIG.coach.tipLifetimeMs };
  }

  update(state, throttle, paused) {
    if (!this.enabled) return;
    const safe = !paused && !this.listening && (state.guidedDemo || !state.airborne &&
      (state.speedKmh < CONFIG.coach.stoppedSpeedKmh ||
        (Math.abs(state.steer) < CONFIG.coach.straightSteer && (throttle > CONFIG.coach.straightThrottle || state.telemetry?.source === "live" && state.telemetry.brake < 0.1))));
    if (this.current && !safe && !this.current.urgent) {
      if (this.current.kind === "acknowledgment") this.acknowledgment = this.current;
      else if (!this.pending) this.pending = this.current;
      this.current = null;
      window.speechSynthesis.cancel();
    }
    if (this.acknowledgment && performance.now() > this.acknowledgment.expires) this.acknowledgment = null;
    const message = this.pending?.urgent ? this.pending : this.acknowledgment || this.pending;
    if (!message || this.current) return;
    if (performance.now() > message.expires) {
      this.pending = null;
      return;
    }
    if (paused || this.listening || (!safe && !message.urgent)) return;
    if (message === this.acknowledgment) this.acknowledgment = null;
    else this.pending = null;
    this.speak(message);
  }

  preview(lang) {
    if (!("speechSynthesis" in window) || this.listening) return;
    this.clear();
    this.speak({ text: lang === "ja" ? "無線チェック。レースエンジニアの準備ができています。" : "Radio check. Your race engineer is ready.", lang: lang, expires: performance.now() + CONFIG.coach.tipLifetimeMs });
  }

  speak(message) {
    this.current = message;
    const speech = new SpeechSynthesisUtterance(message.text);
    this.utterance = speech;
    speech.lang = message.lang === "ja" ? "ja-JP" : "en-US";
    const availableVoices = window.speechSynthesis.getVoices?.() || [];
    const selectedVoice = availableVoices.find(function (voice) {
      return (voice.voiceURI || voice.name) === this.voiceName && voice.lang.startsWith(message.lang);
    }.bind(this));
    if (selectedVoice) speech.voice = selectedVoice;
    speech.rate = CONFIG.coach.speechRate;
    const finish = function () {
      if (this.utterance === speech) {
        this.current = null;
        this.utterance = null;
        this.lastSpeechEndedAt=performance.now();
      }
    }.bind(this);
    speech.onend = finish;
    speech.onerror = function (event) {
      finish();
      if (!["canceled", "interrupted"].includes(event.error)) this.onStatus("Voice playback failed (" + event.error + "). The reply is still visible in text.");
    }.bind(this);
    window.speechSynthesis.speak(speech);
  }

  startListening(lang) {
    if (!this.recognition || this.listening) return false;
    this.clear();
    this.transcript = "";
    this.cancelled = false;
    this.stopping = false;
    this.recognition.lang = lang === "ja" ? "ja-JP" : "en-US";
    this.listening = true;
    try {
      this.recognition.start();
      this.onStatus("Listening… speak your question, then pause. Or click Finish talking / release V.");
      return true;
    } catch {
      this.listening = false;
      this.onStatus("Microphone unavailable. Type your question instead.");
      return false;
    }
  }

  stopListening(cancel = false) {
    if (!this.listening || !this.recognition) return;
    if (cancel) {
      this.cancelled = true;
      this.transcript = "";
      this.recognition.abort();
    } else if (!this.stopping) {
      this.stopping = true;
      this.recognition.stop();
      this.onStatus("Finishing your question…");
    }
  }
}
