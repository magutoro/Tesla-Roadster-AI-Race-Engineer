// Owner: friend — live state adapter, AI coach UI, and the lap-summary integration.
import { DemoGuide, inferDemo } from "./shared/demo-guide.js";
import { EngineerJournal } from "./shared/engineer-journal.js";
import { LiveDrivingCoach } from "./shared/live-coaching.js";
import { CONFIG } from "./config.js";
import { PRACTICE_GOALS, cleanPracticeGoal, inferPracticeGoal } from "./shared/practice-goal.js";
import { focusText, outcomeText, naturalReply } from "./shared/coaching-text.js";
import { EngineerVoice, instantCallout } from "./voice.js";

function memoryId() {
  // LAN HTTP pages may lack randomUUID; these IDs are grouping keys, not login tokens.
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "driver-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
}

export class RaceEngineer {
  constructor(options = {}) {
    this.liveCoach = new LiveDrivingCoach();
    this.lastLiveTipAt = -Infinity;
    this.pendingLiveTip = null;
    this.dataset = options.dataset === "demo" ? "demo" : "live";
    this.driverId = memoryId();
    try {
      this.driverId = window.localStorage.getItem("race-driver-id") || this.driverId;
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(this.driverId)) this.driverId = memoryId();
      window.localStorage.setItem("race-driver-id", this.driverId);
    } catch {}
    this.sessionId = memoryId();
    this.continuous = options.continuous !== false;
    let storage; try { storage=window.localStorage; } catch {}
    this.journal=new EngineerJournal(storage,this.sessionId,this.dataset);
    this.lastInputRecord=0;
    this.lastInputSignature="";
    this.guide=null;
    this.guideChanged=false;
    this.trackId = "blank";
    this.memoryControllers = new Set();
    this.pendingLapWrite = Promise.resolve();
    this.pendingAcknowledgment = Promise.resolve();
    this.acknowledging = new Set();
    this.currentFocus = null;
    this.currentOutcome = null;
    this.enabled = false;
    this.state = null;
    this.history = [];
    this.observations = [];
    this.coachingHistory = [];
    this.pendingAIExplanation = false;
    this.lapMeasurements = [];
    this.conversation = [];
    this.practiceGoal = cleanPracticeGoal();
    this.planBusy = false;
    this.pendingGoalPlan = false;
    this.events = new Set();
    this.previousEvents = new Set();
    this.lastRequest = -Infinity;
    this.lastRequestWallTime = 0;
    this.controller = null;
    this.generation = 0;
    this.lapGeneration = 0;
    this.paused = true;
    this.lastTip = "";
    this.queuedQuestion = "";
    this.needsLapFeedback = false;
    this.panel = document.createElement("section");
    this.panel.id = "engineer";
    this.panel.className = "panel";
    this.panel.setAttribute("aria-label", "Race engineer");
    this.panel.innerHTML = `
      <div class="engineer-heading">
        <svg class="engineer-avatar" viewBox="0 0 100 112" aria-hidden="true">
          <circle cx="50" cy="54" r="45" fill="#263d48"/>
          <path d="M15 112v-7c0-19 16-28 35-28s35 9 35 28v7" fill="#d9e6dc"/>
          <path d="M40 76v14l10 9 10-9V76" fill="#c88e69"/>
          <rect x="25" y="21" width="50" height="64" rx="24" fill="#e6b08b"/>
          <path d="M25 47V31c0-15 11-24 25-24s25 9 25 24v12l-9-15-24 5-12-3z" fill="#252b33"/>
          <path d="M23 48V36C23 0 77 0 77 36v12" fill="none" stroke="#89dce4" stroke-width="7"/>
          <rect x="16" y="42" width="13" height="25" rx="6" fill="#14242d" stroke="#89dce4" stroke-width="2"/>
          <rect x="71" y="42" width="13" height="25" rx="6" fill="#14242d" stroke="#89dce4" stroke-width="2"/>
          <g class="engineer-eyes" fill="#222b32"><circle cx="39" cy="49" r="3"/><circle cx="61" cy="49" r="3"/></g>
          <path d="M34 40l9-1m14 0 9 1" stroke="#644538" stroke-width="2" stroke-linecap="round"/>
          <path d="M49 52l-2 8h5" fill="none" stroke="#bc7d5a" stroke-width="2" stroke-linecap="round"/>
          <ellipse class="engineer-mouth" cx="50" cy="70" rx="8" ry="2" fill="#704836"/>
          <path d="M77 63v7c0 6-9 8-17 8" fill="none" stroke="#89dce4" stroke-width="3"/>
          <rect x="54" y="74" width="12" height="6" rx="3" fill="#14242d"/>
          <path d="M50 99v13" stroke="#92aaa4" stroke-width="2"/>
        </svg>
        <div><strong>Race engineer</strong><span class="engineer-mood">Standing by</span></div>
      </div>
      <button type="button" class="engineer-power" aria-pressed="false">Engineer off</button>
      <small class="engineer-cost">On enables spoken AI coaching · uses AI credits</small>
      <p class="demo-stage" role="status"></p>
      <details class="engineer-settings"><summary>Settings & driving evidence</summary>
      <div class="engineer-controls">
        <select aria-label="Engineer language"><option value="en">English</option><option value="ja">日本語</option></select>
        <button type="button" class="voice-toggle" aria-pressed="false">Voice off</button></div>
      <label class="engineer-voice-label">Mac / browser voice
        <select class="engineer-voice" aria-label="Speaking voice"><option value="">Device default</option></select>
      </label>
      <button type="button" class="hands-free-toggle" aria-pressed="false">Hands-free conversation · Off</button>

      <button type="button" class="voice-preview">Preview voice · free</button>
      <label class="engineer-voice-label">Practice goal
        <select class="practice-goal" aria-label="Practice goal">
          <option value="general">Overall driving</option>
          <option value="corner_speed">Corner speed</option>
          <option value="braking">Braking</option>
          <option value="corner_exit">Corner exit / throttle</option>
        </select>
      </label>
      <small class="practice-label">Set a goal by typing or talking, e.g. “I want to work on corner speed.”</small>
      <p class="practice-evidence"></p>
      <label class="engineer-auto"><input type="checkbox"> Automatic AI coaching (uses AI credits)</label>

      <div class="engineer-memory" role="status">Neo4j memory: not checked</div>
      <button type="button" class="memory-check">Check memory · no AI credits</button>
      <button type="button" class="measured-focus">Measured focus · no AI credits</button>
      <section class="coaching-evidence" aria-label="Measured coaching" hidden>
        <strong class="focus-heading">Next attempt</strong>
        <p class="focus-action"></p>
        <small class="focus-evidence"></small>
        <p class="focus-outcome"></p>
        <button type="button" class="focus-dismiss">Clear this focus</button>
      </section>
      </details>
      <p class="engineer-tip" aria-live="polite">Engineer is off.</p>
      <div class="engineer-status" role="status">Off · no AI requests</div>
      <a class="engineer-history-link" href="/engineer-chat.html" target="_blank" rel="noopener">Review chat & input records ↗</a>
      <details class="engineer-thread"><summary>Current conversation</summary><div class="thread-messages" role="log" aria-label="Engineer conversation"></div></details>
      <p class="engineer-question" hidden></p>
      <form><input aria-label="Question for your engineer" placeholder="Take me through the Reveal Jump…" maxlength="400"><button>Ask</button></form>
      <small class="hands-free-status" role="status">Listens between replies. Speak, then pause to send.</small>
      <button type="button" class="engineer-talk" aria-pressed="false">Talk to engineer</button>
      <small class="speech-note">Click Talk, speak, then pause for a reply. Or hold V and release to send. Uses your browser’s speech service.</small>`;
    document.body.appendChild(this.panel);
    this.thread=this.panel.querySelector(".thread-messages");
    this.demoStage=this.panel.querySelector(".demo-stage");
    this.language = this.panel.querySelector("select");
    this.language.value = CONFIG.coach.language;
    this.practiceSelect = this.panel.querySelector(".practice-goal");
    this.practiceLabel = this.panel.querySelector(".practice-label");
    this.practiceEvidence = this.panel.querySelector(".practice-evidence");
    this.practiceSelect.value = this.practiceGoal.type;
    this.practiceSelect.addEventListener("change", function () {
      this.setPracticeGoal({ type: this.practiceSelect.value, corner: "" });
      this.practiceSelect.blur();
    }.bind(this));
    this.tip = this.panel.querySelector(".engineer-tip");
    this.status = this.panel.querySelector(".engineer-status");
    this.memoryStatus = this.panel.querySelector(".engineer-memory");
    this.coachingPanel = this.panel.querySelector(".coaching-evidence");
    this.focusAction = this.panel.querySelector(".focus-action");
    this.focusEvidence = this.panel.querySelector(".focus-evidence");
    this.focusOutcome = this.panel.querySelector(".focus-outcome");
    this.dismissButton = this.panel.querySelector(".focus-dismiss");
    this.dismissButton.addEventListener("click", function () {
      if (!this.enabled || !this.currentFocus) return;
      this.memoryRequest("/api/memory/focus/dismiss", { enabled: true, scope: this.memoryScope(), id: this.currentFocus.id });
    }.bind(this));
    this.focusButton = this.panel.querySelector(".measured-focus");
    this.focusButton.addEventListener("click", this.loadMeasuredFocus.bind(this));
    this.panel.querySelector(".memory-check").addEventListener("click", function () {
      this.memoryRequest("/api/memory/status?check=true");
    }.bind(this));
    this.mood = this.panel.querySelector(".engineer-mood");
    this.handsFreeButton=this.panel.querySelector(".hands-free-toggle");
    this.handsFreeStatus=this.panel.querySelector(".hands-free-status");
    this.handsFreeButton.addEventListener("click",function(){
      if(!this.enabled)return;
      if(this.voice.handsFree) this.voice.setHandsFree(false);
      else {
        this.startConversation();
        this.voice.setHandsFree(true);
      }
      this.refreshFace();
      this.handsFreeButton.blur();
    }.bind(this));
    this.questionText = this.panel.querySelector(".engineer-question");
    this.talk = this.panel.querySelector(".engineer-talk");
    this.power = this.panel.querySelector(".engineer-power");
    this.autoTips = this.panel.querySelector(".engineer-auto input");
    this.sendButton = this.panel.querySelector("form button");
    this.voiceChoice = this.panel.querySelector(".engineer-voice");
    this.previewButton = this.panel.querySelector(".voice-preview");
    this.input = this.panel.querySelector("form input");
    this.input.maxLength = CONFIG.coach.maxQuestionLength;
    this.voice = new EngineerVoice(this.ask.bind(this), this.setStatus.bind(this), function (text) {
      this.questionText.textContent = "Hearing: “" + text + "”";
      this.questionText.hidden = false;
    }.bind(this));
    try { this.voice.voiceName = window.localStorage.getItem("race-engineer-voice") || ""; } catch {}
    this.power.addEventListener("click", function () {
      this.setPower(!this.enabled);
      this.power.blur();
    }.bind(this));
    this.voiceChoice.addEventListener("change", function () {
      this.voice.voiceName = this.voiceChoice.value;
      try { window.localStorage.setItem("race-engineer-voice", this.voice.voiceName); } catch {}
      this.voice.clear();
      this.voiceChoice.blur();
    }.bind(this));
    this.populateVoices();
    this.previewButton.disabled = !("speechSynthesis" in window);
    this.previewButton.addEventListener("click", function () {
      this.voice.preview(this.language.value);
      this.previewButton.blur();
    }.bind(this));
    if (window.speechSynthesis?.addEventListener) {
      window.speechSynthesis.addEventListener("voiceschanged", this.populateVoices.bind(this));
    }
    const toggle = this.panel.querySelector(".voice-toggle");
    this.voiceToggle = toggle;
    toggle.addEventListener("click", function () {
      const enabled = this.voice.setEnabled(!this.voice.enabled);
      toggle.textContent = enabled ? "Voice on" : "Voice off";
      toggle.setAttribute("aria-pressed", String(enabled));
      toggle.blur();
    }.bind(this));
    this.panel.querySelector("form").addEventListener("submit", function (event) {
      event.preventDefault();
      this.ask(this.input.value);
    }.bind(this));
    this.language.addEventListener("change", function () {
      this.invalidate();
      this.lastRequest = -Infinity;
      this.lastRequestWallTime = 0;
      this.lastTip = "";
      this.language.blur();
    }.bind(this));
    const talk = this.talk;
    if (!this.voice.recognition) {
      talk.disabled = true;
      talk.textContent = "Voice input unavailable — type above";
    }
    talk.addEventListener("click", function () {
      if (this.voice.listening) this.voice.stopListening();
      else this.startConversation();
      talk.blur();
    }.bind(this));
    talk.addEventListener("keydown", function (event) {
      if (event.code === "Space" || event.code === "Enter") event.stopPropagation();
    });
    window.addEventListener("keydown", function (event) {
      if (event.code !== CONFIG.coach.pushToTalkKey || event.repeat || event.target.closest("input, select, textarea")) return;
      if (!this.paused) this.startConversation();
    }.bind(this));
    window.addEventListener("keyup", function (event) {
      if (event.code === CONFIG.coach.pushToTalkKey) this.voice.stopListening();
    }.bind(this));
    window.addEventListener("blur", function () { this.voice.stopListening(true); }.bind(this));
    // Analysis can dispatch this event after analysis without importing game internals.
    window.addEventListener("race:lap-summary", function (event) { this.addLapSummary(event.detail); }.bind(this));
    document.addEventListener?.("visibilitychange", function () {
      if (!document.hidden && this.enabled) this.showCoaching({});
    }.bind(this));
    this.setPower(false);
  }

  populateVoices() {
    const selected = this.voice.voiceName || this.voiceChoice.value;
    this.voiceChoice.replaceChildren();
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "Device default";
    this.voiceChoice.appendChild(defaultOption);
    for (const voice of window.speechSynthesis?.getVoices?.() || []) {
      if (!voice.lang.startsWith("en") && !voice.lang.startsWith("ja")) continue;
      const option = document.createElement("option");
      option.value = voice.voiceURI || voice.name;
      option.textContent = voice.name + " · " + voice.lang;
      this.voiceChoice.appendChild(option);
    }
    this.voiceChoice.value = selected;
  }

  setPower(enabled) {
    this.enabled = enabled;
    this.invalidate();
    this.events.clear();
    this.previousEvents.clear();
    this.lastRequest = -Infinity;
    this.lastRequestWallTime = 0;
    this.lastTip = "";
    if (!enabled) {
      this.pendingGoalPlan = false;
      this.voice.setEnabled(false);
      this.voiceToggle.textContent = "Voice off";
      this.voiceToggle.setAttribute("aria-pressed", "false");
      this.autoTips.checked = false;
      this.tip.textContent = "Engineer is off.";
    } else {
      if(this.continuous) {
        this.autoTips.checked=true;
        this.voice.setEnabled(true);
        this.voiceToggle.textContent="Voice on";
        this.voiceToggle.setAttribute("aria-pressed","true");
        this.pendingAIExplanation=true;
        this.voice.setHandsFree(true);
      }
      this.tip.textContent = "I’m with you. Tell me what you want to practice.";
    }
    this.power.textContent = enabled ? "Engineer on" : "Engineer off";
    this.power.setAttribute("aria-pressed", String(enabled));
    this.voiceToggle.disabled = !enabled;
    this.talk.disabled = !enabled || !this.voice.recognition;
    this.handsFreeButton.disabled = !enabled || !this.voice.recognition;
    this.input.disabled = !enabled;
    this.sendButton.disabled = !enabled;
    this.autoTips.disabled = !enabled;
    this.practiceSelect.disabled = !enabled;
    this.focusButton.disabled = !enabled;
    this.coachingPanel.hidden = !enabled || (!this.currentFocus && !this.currentOutcome);
    this.setStatus(enabled ? "Live voice coaching on · ask for a stunt walkthrough" : "Off · no AI requests");
  }

  setStatus(text) {
    this.status.textContent = this.enabled ? text : "Off · no AI requests";
    this.refreshFace();
  }

  startConversation() {
    if (!this.enabled) return;
    if (this.paused || !this.state) {
      this.setStatus("Choose Free drive before talking to your engineer.");
      return;
    }
    this.invalidate(true); // Give the microphone priority over an automatic tip, preserving measured writes.
    // Starting a conversation also enables the engineer's spoken reply.
    const enabled = this.voice.setEnabled(true);
    this.voiceToggle.textContent = enabled ? "Voice on" : "Voice off";
    this.voiceToggle.setAttribute("aria-pressed", String(enabled));
    this.voice.startListening(this.language.value);
    this.refreshFace();
  }

  refreshFace() {
    let expression = "idle";
    let label = "Standing by";
    if (!this.enabled) {
      expression = "off";
      label = "Off";
    } else if (this.voice?.listening) {
      expression = "listening";
      label = "Listening to you";
    } else if (this.voice?.current) {
      expression = "speaking";
      label = "On the radio";
    } else if (this.controller) {
      expression = "thinking";
      label = "Reading the drive";
    }
    this.panel.dataset.expression = expression;
    this.mood.textContent = label;
    this.previewButton.disabled = !("speechSynthesis" in window) || this.voice?.listening;
    if(this.handsFreeButton && this.voice) {
      this.handsFreeButton.textContent="Hands-free conversation · "+(this.voice.handsFree?"On":"Off");
      this.handsFreeButton.setAttribute("aria-pressed",String(this.voice.handsFree));
      this.handsFreeStatus.textContent=!this.enabled ? "Turn Engineer on to enable hands-free conversation." : !this.voice.recognition ? "Speech input unavailable in this browser." :
        this.voice.handsFreeError ? "Microphone unavailable ("+this.voice.handsFreeError+"). Hands-free stopped; try again or use another browser." :
        this.voice.handsFree ? (this.paused ? "Paused with the game." : this.voice.listening ? "Listening automatically. Speak, then pause to send." : "Waiting for the engineer to finish, then listening again.") :
        "Listens between replies. Speak, then pause to send.";
    }
    if (this.voice?.recognition) {
      this.talk.textContent = this.voice.stopping ? "Sending question…" : this.voice.listening ? "Finish talking" : "Talk to engineer";
      this.talk.setAttribute("aria-pressed", String(this.voice.listening));
    }
  }

  invalidate(preserveLapWrites = false) {
    this.generation++;
    if (!preserveLapWrites) {
      this.lapGeneration++;
      for (const controller of this.memoryControllers) controller.abort();
      this.memoryControllers.clear();
    }
    if (this.controller) this.controller.abort();
    this.controller = null;
    this.voice.clear();
    this.voice.stopListening(true);
    this.queuedQuestion = "";
  }

  record(role,text,extra={}) {
    this.journal.append(role,text,{trackId:this.trackId,...extra});
    if(this.journal.failed) this.panel.querySelector(".engineer-history-link").textContent="History could not save · browser storage unavailable";
    if(role!=="input") {
      const line=document.createElement("p");
      line.textContent=(role==="user"?"You: ":role==="engineer"?"Engineer: ":"Drive: ")+text;
      this.thread.appendChild(line);
      if(this.thread.children.length>40) this.thread.children[0].remove?.();
    }
  }

  reset(preserveGuide=true) {
    if(this.guide && preserveGuide) {
      this.record("drive","Attempt reset",{attempt:this.guide.summary()});
      this.guide.reset(); this.guideChanged=true; this.lastGuidePhase="";
    } else if(!preserveGuide) { this.guide=null; this.demoStage.textContent=""; }
    this.liveCoach.reset();
    this.lastLiveTipAt = -Infinity;
    this.pendingLiveTip = null;
    this.invalidate();
    this.history = [];
    this.observations = [];
    this.coachingHistory = [];
    this.pendingAIExplanation = false;
    this.lapMeasurements = [];
    if(!this.guide) this.conversation = [];
    this.practiceEvidence.textContent = "";
    this.currentFocus = null;
    this.currentOutcome = null;
    this.coachingPanel.hidden = true;
    this.events.clear();
    this.previousEvents.clear();
    this.state = null;
    this.lastRequest = -Infinity;
    this.lastRequestWallTime = 0;
    this.lastTip = "";
    this.needsLapFeedback = false;
    this.tip.textContent = this.enabled ? "Ask your engineer for advice." : "Engineer is off.";
    this.questionText.hidden = true;
    this.setStatus("Waiting for driving data");
  }

  setTrack(file) {
    this.trackId = file.split("/").pop().replace(/\.json$/, "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100) || "blank";
  }

  memoryScope() {
    return { driverId: this.driverId, sessionId: this.sessionId, trackId: this.trackId,
      mode: this.state?.mode || "performance", dataset: this.dataset };
  }

  showMemory(result) {
    const labels = { not_configured: "add Aura credentials to .env", unavailable: "unavailable; local coaching continues",
      busy: "busy", connected: "connected" };
    this.memoryStatus.textContent = "Neo4j memory: " + (labels[result.status] || result.status);
    if (result.data?.recentLaps) result = { ...result, laps: result.data.recentLaps.length };
    if (result.laps !== undefined) this.memoryStatus.textContent += " · " + result.laps + " past laps recalled";
    if (result.data?.practice && result.status !== "connected") this.memoryStatus.textContent += " · using this tab’s measured laps";
    if (result.data?.reason === "lap_id_conflict") this.memoryStatus.textContent = "Lap ID already used; corrected analysis needs a new ID.";
    if (this.dataset === "demo") this.memoryStatus.textContent += " · examples only";
  }

  async memoryRequest(url, body) {
    const controller = new AbortController();
    this.memoryControllers.add(controller);
    const generation = this.generation;
    const timeout = setTimeout(function () { controller.abort(); }, CONFIG.memory.browserTimeoutMs);
    try {
      const response = await fetch(url, { method: body ? "POST" : "GET", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      if (!response.ok) throw new Error("memory_unavailable");
      const result = await response.json();
      if (generation === this.generation) {
        this.showMemory(result);
        if (this.enabled && result.data && ("focus" in result.data || "outcome" in result.data)) this.showCoaching(result.data);
        if (this.enabled && result.data?.practice) this.showPractice(result.data.practice);
      }
      return result;
    } catch {
      if (generation === this.generation) this.showMemory({ status: "unavailable" });
    } finally { clearTimeout(timeout); this.memoryControllers.delete(controller); }
  }

  showCoaching(coaching) {
    if (!this.enabled) return;
    if ("focus" in coaching) this.currentFocus = coaching.focus || null;
    if ("outcome" in coaching) this.currentOutcome = coaching.outcome || null;
    if (this.currentOutcome?.recommendationId === this.currentFocus?.id) this.currentFocus = null;
    const focus = this.currentFocus;
    this.coachingPanel.hidden = !focus && !this.currentOutcome;
    this.focusAction.textContent = focus ? (focus.comparableNow === false ?
      "Waiting for a valid attempt with the original reference and settings." : focusText(focus, this.language.value, this.dataset)) : "";
    this.focusEvidence.textContent = focus ? focus.evidenceLapIds.length + " comparable laps · " + focus.confidence +
      " evidence · average measured loss " + focus.meanLossSeconds + " s. Potential gain is not established." : "";
    this.dismissButton.hidden = !focus;
    this.focusOutcome.textContent = this.currentOutcome ? outcomeText(this.currentOutcome, this.language.value, this.dataset) : "";
    if (focus?.status === "proposed" && !document.hidden && !this.acknowledging.has(focus.id)) {
      // A cue is eligible for evaluation only after it has actually appeared in the UI.
      this.acknowledging.add(focus.id);
      this.pendingAcknowledgment = this.memoryRequest("/api/memory/focus/ack", { enabled: true, scope: this.memoryScope(), id: focus.id })
        .finally(function () { this.acknowledging.delete(focus.id); }.bind(this));
    }
  }

  showPractice(report) {
    this.practiceLabel.textContent = "Working on: " + report.label + " · feedback after measured laps · no AI credits";
    this.practiceEvidence.textContent = report.evidence.join(" ");
  }

  setPracticeGoal(goal) {
    if (!this.enabled) return;
    this.invalidate(true); // changing the practice question must not discard pending measured laps
    this.practiceGoal = cleanPracticeGoal(goal);
    this.practiceSelect.value = this.practiceGoal.type;
    this.currentFocus = null;
    this.currentOutcome = null;
    this.coachingPanel.hidden = true;
    this.practiceEvidence.textContent = "";
    this.practiceLabel.textContent = "Working on: " + PRACTICE_GOALS[this.practiceGoal.type] + (this.practiceGoal.corner ? " · " + this.practiceGoal.corner : "");
    this.pendingGoalPlan = true;
    this.loadMeasuredFocus();
  }

  async loadMeasuredFocus() {
    if (!this.enabled || this.planBusy) return;
    this.planBusy = true;
    this.pendingGoalPlan = false;
    const generation = this.generation;
    try {
      await this.pendingLapWrite;
      if (!this.enabled || generation !== this.generation) return;
      const result = await this.memoryRequest("/api/memory/focus", { enabled: true, scope: this.memoryScope(),
        practiceGoal: this.practiceGoal, laps: this.lapMeasurements });
      if (generation === this.generation && result?.data?.practice) {
        this.tip.textContent = result.data.practice.text;
        this.setStatus("Practice plan · no AI credits");
        const text = result.data.focus ? focusText(result.data.focus, this.language.value, this.dataset) : result.data.practice.text;
        if(this.autoTips.checked || this.queuedQuestion) {
          this.lastRequest=-Infinity;
          this.pendingAIExplanation=true;
          this.setStatus("Measured evidence ready · asking ai& for coaching…");
        } else if (text !== this.lastTip) { this.voice.queue({ text: text, lang: this.language.value }); this.lastTip = text; }
      }
      return result;
    } finally {
      this.planBusy = false;
      if (this.enabled && this.pendingGoalPlan) this.loadMeasuredFocus();
    }
  }

  async loadDemoNextLap() {
    if (!this.enabled || this.dataset !== "demo") return;
    if (!this.currentFocus || this.currentFocus.comparableNow === false) {
      this.setStatus("Show a measured focus before sending the next example lap.");
      return;
    }
    const generation = this.generation;
    await this.pendingAcknowledgment;
    if (!this.enabled || generation !== this.generation) return;
    return this.memoryRequest("/api/memory/demo-next", { enabled: true, scope: this.memoryScope() });
  }

  loadDemoMemory() {
    if (!this.enabled || this.dataset !== "demo") return;
    return this.memoryRequest("/api/memory/demo", { enabled: true, scope: this.memoryScope() });
  }

  addLapSummary(detail) {
    const lap = typeof detail === "string" ? { id: memoryId(), summary: detail, corners: [] } : detail;
    if (this.dataset === "live" && lap?.source && lap.source !== "live") {
      this.setStatus("Ignored replay/example data in live driving.");
      return;
    }
    if (!lap || typeof lap.summary !== "string" || !lap.summary.trim()) return;
    this.lapMeasurements.push(structuredClone(lap));
    this.lapMeasurements = this.lapMeasurements.slice(-CONFIG.coach.maxHistory);
    this.history.push(lap.summary.trim().slice(0, CONFIG.coach.maxSummaryLength));
    this.history = this.history.slice(-CONFIG.coach.maxHistory);
    if (this.enabled) {
      const generation = this.generation;
      const lapGeneration = this.lapGeneration;
      const scope = this.memoryScope();
      this.pendingLapWrite = this.pendingLapWrite.then(async function () {
        if (!this.enabled || lapGeneration !== this.lapGeneration) return;
        const result = await this.memoryRequest("/api/memory/laps", { enabled: true, scope: scope, lap: lap });
        if (generation === this.generation && result?.data?.stored !== false) this.needsLapFeedback = true;
      }.bind(this));
    } else this.needsLapFeedback = true;
  }

  update(state, throttle, paused = false, liveSample = null) {
    if (this.state && this.state.mode !== state.mode) {
      this.invalidate();
      this.history = [];
      this.observations = [];
      this.coachingHistory = [];
      this.pendingAIExplanation = false;
      this.lapMeasurements = [];
      this.conversation = [];
      this.practiceEvidence.textContent = "";
      this.currentFocus = null;
      this.currentOutcome = null;
      this.coachingPanel.hidden = true;
      this.needsLapFeedback = false;
    }
    if (paused && !this.paused) this.invalidate();
    this.paused = paused;
    this.state = state;
    if (!this.enabled) return;
    const newEvents = [];
    for (const event of state.events || []) {
      if (!this.previousEvents.has(event)) newEvents.push(event);
    }
    this.previousEvents = new Set(state.events || []);
    const callout = instantCallout(newEvents.filter(function(event){return ["crash","flip","tank_empty"].includes(event);}), this.language.value);
    if (!paused && callout) {
      this.tip.textContent = callout.text;
      this.setStatus("Instant callout · driving event");
      this.voice.queue(callout, true);
    }
    if (this.dataset === "live" && !paused && liveSample && Date.now()-liveSample.timestampMs<CONFIG.liveCoaching.maximumAgeMs) {
      const liveTip=this.liveCoach.update(liveSample,this.language.value);
      if(liveTip) {
        this.observations.push({source:liveTip.source,kind:liveTip.kind,trackId:liveTip.trackId,capturedAt:liveTip.capturedAt,evidence:liveTip.evidence});
        this.observations=this.observations.slice(-CONFIG.coach.maximumObservations);
        if(liveTip.kind==="off_track") this.pendingLiveTip=liveTip;
      }
      if(this.pendingLiveTip && Date.now()-this.pendingLiveTip.capturedAt>CONFIG.liveCoaching.maximumAgeMs) this.pendingLiveTip=null;
      if(this.pendingLiveTip && !callout && !this.voice.current?.urgent && !this.queuedQuestion && !this.controller && !this.planBusy && !this.voice.acknowledgment) {
        this.tip.textContent=this.pendingLiveTip.text;
        this.setStatus("Live telemetry · just measured · no AI credits");
        this.voice.queue(this.pendingLiveTip,this.pendingLiveTip.kind === "off_track");
        this.pendingLiveTip=null;
        this.lastLiveTipAt=performance.now();
      }
    }
    if(this.dataset==="live" && !paused && state.stunt) {
      if(this.guide && this.guide.update(state)) {
        this.guideChanged=true;
        this.record("drive",this.guide.context().name+" · "+this.guide.phase,{attempt:this.guide.summary(),inputs:state.stunt});
        // Phase cues are local and immediate; the model explains the attempt asynchronously.
        const cue={top:"Top of the curl. Tap ROLL once.",climb:this.trackId==="tesla-event"?"Ramp now. Be ready for a short LIFT.":"Climbing. Keep FANS on and stay centered.",flight:"Airborne. Keep it straight; watch the landing.",landed:"Touchdown. Head for the green zone.",complete:"Goal confirmed. Nice work.",failed:"Impact recorded. Reset when you’re ready."}[this.guide.phase];
        if(cue && !callout && this.lastGuidePhase!==this.guide.phase) {
          if(this.voice.listening && !this.voice.userSpeaking) this.voice.stopListening(true);
          this.voice.queue({text:cue,lang:this.language.value,source:"guide-cue"},true);
          this.record("engineer",cue,{source:"guide-cue"});
        }
        this.lastGuidePhase=this.guide.phase;
      }
      if(this.guide) this.demoStage.textContent=this.guide.context().name+" · attempt "+this.guide.number+" · "+this.guide.phase;
      const t=state.stunt;
      const signature=JSON.stringify([t.thrust,t.lift,t.roll,state.fansOn,state.mode]);
      if(Date.now()-this.lastInputRecord>=2000 || signature!==this.lastInputSignature) {
        this.record("input","Driving inputs",{inputs:t,speedKmh:state.speedKmh,fansOn:state.fansOn,mode:state.mode,phase:this.guide?.phase});
        this.lastInputRecord=Date.now(); this.lastInputSignature=signature;
      }
    }
    this.voice.update({...state,guidedDemo:Boolean(this.guide)}, throttle, paused);
    const meaningfulDriving=state.speedKmh>=CONFIG.liveCoaching.minimumSpeedKmh || this.events.size>0 || this.observations.some(function(item){return item.capturedAt>this.lastRequestWallTime;}.bind(this));
    const automaticDue=this.autoTips.checked && (meaningfulDriving || this.pendingAIExplanation || this.guideChanged) && performance.now()-this.lastLiveTipAt>=CONFIG.coach.intervalMs && performance.now()-this.lastRequest>=CONFIG.coach.intervalMs &&
      (!this.voice.handsFree || performance.now()-this.voice.lastSpeechEndedAt>=CONFIG.coach.handsFreeListenWindowMs) && !this.voice.userSpeaking && !this.voice.current && !this.voice.pending && !this.voice.acknowledgment;
    this.voice.pollHandsFree(this.language.value,paused || Boolean(this.controller) || this.planBusy || Boolean(this.queuedQuestion) || Boolean(this.voice.pending?.guided) || automaticDue);
    this.refreshFace();
    if (paused) return;
    for (const event of state.events || []) this.events.add(event);
    if (this.voice.listening) return;
    if (this.controller || this.planBusy) return;
    if (this.needsLapFeedback) {
      this.needsLapFeedback = false;
      this.loadMeasuredFocus();
      return;
    }
    if (this.queuedQuestion) {
      const question = this.queuedQuestion;
      this.queuedQuestion = "";
      this.request(question);
    } else if (automaticDue) {
      this.needsLapFeedback = false;
      this.request();
    }
  }

  ask(question) {
    if (!this.enabled) return;
    question = question.trim().slice(0, CONFIG.coach.maxQuestionLength);
    if (!question) return;
    this.record("user",question,{inputs:this.state?.stunt || null});
    const demo=inferDemo(question);
    if(demo && this.dataset==="live") {
      this.input.value="";
      this.voice.acknowledge(this.language.value);
      if(!this.onDemoRequest) {this.setStatus("Stunt walkthroughs are available in the driving simulator.");return;}
      this.setStatus("Loading your stunt walkthrough…");
      Promise.resolve(this.onDemoRequest(demo)).then(()=>{
        if(!this.enabled) return;
        this.guide=new DemoGuide(demo); this.lastGuidePhase=""; this.guideChanged=true;
        this.queuedQuestion=question; this.pendingAIExplanation=true;
        this.record("drive","Started "+this.guide.context().name+" walkthrough");
      }).catch(()=>this.setStatus("Could not load the stunt. Try the level menu, then ask again."));
      return;
    }
    const goal = inferPracticeGoal(question);
    if (goal) {
      this.input.value = "";
      this.input.blur();
      this.questionText.textContent = "You: “" + question + "”";
      this.questionText.hidden = false;
      this.setPracticeGoal(goal);
      this.queuedQuestion=question; // A spoken/typed goal deserves an AI reply after evidence lookup.
      this.voice.acknowledge(this.language.value);
      this.setStatus("Heard you. Checking measured laps for your practice goal…");
      return;
    }
    if (!this.state || this.paused) {
      this.setStatus("Start driving before asking your engineer.");
      return;
    }
    this.input.value = "";
    this.input.blur();
    this.questionText.textContent = "You: “" + question + "”";
    this.questionText.hidden = false;
    this.voice.acknowledge(this.language.value);
    if (this.controller) {
      this.queuedQuestion = question;
      this.setStatus("Question queued; waiting for the current reply.");
    } else this.request(question);
  }

  async request(question = "") {
    if (!this.enabled || !this.state || this.paused || this.controller) return;
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.pendingAIExplanation=false;
    this.lastRequest = performance.now();
    this.lastRequestWallTime = Date.now();
    const state = { ...this.state, events: Array.from(this.events) };
    this.events.clear();
    const lang = this.language.value;
    const guide=this.guide?.context() || null;
    this.guideChanged=false;
    this.setStatus(question ? "Heard you. Checking live driving data and lap memory…" : "Engineer thinking…");
    const timeout = setTimeout(function () { controller.abort(); }, CONFIG.coach.requestTimeoutMs + CONFIG.memory.browserTimeoutMs);
    try {
      await this.pendingLapWrite;
      if (!this.enabled || generation !== this.generation || controller.signal.aborted) return;
      const response = await fetch("/api/coach", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ enabled: true, state: state, lang: lang, history: this.history, question: question,
          practiceGoal: this.practiceGoal, laps: this.lapMeasurements, conversation: this.conversation,
          guide:guide, explain: this.autoTips.checked, observations: this.observations, recentCoaching: this.coachingHistory,
          memory: { enabled: true, scope: this.memoryScope() } }),
      });
      if (!response.ok) throw new Error("coach_unavailable");
      const tip = await response.json();
      if(tip.source === "ai") tip.text=naturalReply(tip.text,CONFIG.coach.maxResponseLength);
      if (generation !== this.generation) return;
      if (typeof tip.text !== "string" || !tip.text) throw new Error("empty_tip");
      if (tip.memory) this.showMemory(tip.memory);
      if (tip.coaching) this.showCoaching(tip.coaching);
      if (tip.practice) this.showPractice(tip.practice);
      if(!question && guide && (this.guideChanged || this.guide?.phase!==guide.phase)) {this.lastRequest=-Infinity;return;}
      if (question && tip.source === "ai") {
        this.conversation.push({ question: question, answer: tip.text });
        this.conversation = this.conversation.slice(-CONFIG.coach.conversationTurns);
      }
      // An answer about takeoff is stale after landing. Ask again with the current phase.
      this.tip.textContent = tip.text;
      this.record("engineer",tip.text,{source:tip.source,phase:guide?.phase,inputs:state.stunt || null});
      if(tip.source==="ai") {this.coachingHistory.push(tip.text);this.coachingHistory=this.coachingHistory.slice(-CONFIG.coach.conversationTurns);}
      if (tip.source === "analysis") this.setStatus("Measured coaching · no AI credits");
      else if (tip.source === "ai") this.setStatus("ai& · " + tip.latencyMs + " ms");
      else if (tip.reason === "not_configured") this.setStatus("Practice tips · ai& not configured");
      else this.setStatus("Practice tips · ai& unavailable (" + tip.reason + ")");
      if (question || tip.text !== this.lastTip) {
        this.voice.queue({...tip,source:this.guide?"guide":tip.source});
        this.lastTip = tip.text;
      }
    } catch {
      if (generation === this.generation) this.setStatus("Engineer connection unavailable. Driving continues.");
    } finally {
      clearTimeout(timeout);
      if (generation === this.generation) {
        this.controller = null;
        this.refreshFace();
      }
    }
  }
}
