const DAY_MS = 24 * 60 * 60 * 1000;

function isoDaysAgo(days, hour = 21) {
  const date = new Date(Date.now() - days * DAY_MS);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function demoSessions() {
  return [
    {
      session_id: "demo-session-03",
      title: "慢慢靠近的晚上",
      started_at: isoDaysAgo(1),
      duration_s: 1080,
      mode: "scenario",
      persona_name: "温柔陪伴",
      max_level: 4,
      data_quality: "complete",
      temperature: {
        direction: "rising",
        label: "表面温感缓慢上升后趋稳",
        quality: "complete",
        sample_count: 1080,
      },
      pressure: {
        direction: "varied",
        label: "接触压力中段更有节律",
        quality: "complete",
        sample_count: 1080,
      },
      summary: "本次从较低档位开始，中段节律更连续，结束前主动回到较轻的强度。",
      user_feedback: "前面慢一点很舒服，最后收得也刚好。",
      timeline: [
        { minute: 0, level: 1, pressure_index: 0.18, temperature_delta: 0.0 },
        { minute: 4, level: 2, pressure_index: 0.32, temperature_delta: 0.4 },
        { minute: 8, level: 4, pressure_index: 0.62, temperature_delta: 0.9 },
        { minute: 12, level: 3, pressure_index: 0.54, temperature_delta: 1.1 },
        { minute: 18, level: 1, pressure_index: 0.22, temperature_delta: 0.8 },
      ],
      notes: [],
    },
    {
      session_id: "demo-session-02",
      title: "自己掌握节奏",
      started_at: isoDaysAgo(4),
      duration_s: 720,
      mode: "free",
      persona_name: null,
      max_level: 3,
      data_quality: "partial",
      temperature: {
        direction: "stable",
        label: "表面温感整体平稳",
        quality: "partial",
        sample_count: 510,
      },
      pressure: {
        direction: "stable",
        label: "接触压力变化较少",
        quality: "partial",
        sample_count: 510,
      },
      summary: "本次以手动低档为主。部分传感数据缺失，因此只描述可见事实。",
      user_feedback: "短一点更适合那天的状态。",
      timeline: [
        { minute: 0, level: 1, pressure_index: 0.2, temperature_delta: 0.0 },
        { minute: 4, level: 2, pressure_index: 0.29, temperature_delta: 0.2 },
        { minute: 8, level: 3, pressure_index: 0.33, temperature_delta: 0.3 },
        { minute: 12, level: 1, pressure_index: 0.18, temperature_delta: 0.2 },
      ],
      notes: [],
    },
    {
      session_id: "demo-session-01",
      title: "一次定时体验",
      started_at: isoDaysAgo(8),
      duration_s: 600,
      mode: "wild",
      persona_name: null,
      max_level: 5,
      data_quality: "complete",
      temperature: {
        direction: "stable",
        label: "表面温感在可回看区间内平稳",
        quality: "complete",
        sample_count: 600,
      },
      pressure: {
        direction: "rising",
        label: "后半段接触压力更连续",
        quality: "complete",
        sample_count: 600,
      },
      summary: "本次按预设计时结束。记录只用于回看，不会用于恢复或延长失控模式。",
      user_feedback: "结束得比我预想快，下次想先选更短的时间。",
      timeline: [
        { minute: 0, level: 2, pressure_index: 0.25, temperature_delta: 0.0 },
        { minute: 3, level: 4, pressure_index: 0.43, temperature_delta: 0.3 },
        { minute: 6, level: 5, pressure_index: 0.65, temperature_delta: 0.5 },
        { minute: 10, level: 0, pressure_index: 0.1, temperature_delta: 0.4 },
      ],
      notes: [],
    },
  ];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class BodyNotesState {
  constructor({ fetchImpl = globalThis.fetch, sessions = demoSessions() } = {}) {
    this._fetch = fetchImpl;
    this._seed = clone(sessions);
    this._sessions = clone(sessions);
    this._messages = new Map();
    this._listeners = new Set();
    this.loading = false;
    this.backendAvailable = null;
    this._removedSessionIds = new Set();
  }

  get mutationsLocked() {
    return this.loading || (Boolean(this._fetch) && this.backendAvailable === null);
  }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _notify() {
    for (const fn of this._listeners) fn();
  }

  get sessions() {
    return clone(this._sessions).sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
  }

  getSession(sessionId) {
    const session = this._sessions.find((item) => item.session_id === sessionId);
    return session ? clone(session) : null;
  }

  recentComparisons(sessionId, limit = 5) {
    return this.sessions
      .filter((item) => item.session_id !== sessionId && item.data_quality !== "limited")
      .slice(0, Math.min(limit, 10));
  }

  messages(sessionId, scope) {
    return clone(this._messages.get(`${sessionId}:${scope}`) || []);
  }

  async load() {
    if (!this._fetch || this.loading) return;
    this.loading = true;
    this._notify();
    try {
      const response = await this._request("/v1/body-notes/sessions");
      this.backendAvailable = response.ok;
      if (response.ok && Array.isArray(response.data)) {
        this._sessions = response.data.filter(
          (item) => !this._removedSessionIds.has(item.session_id),
        );
      }
    } finally {
      this.loading = false;
      this._notify();
    }
  }

  async deleteSession(sessionId) {
    if (this.mutationsLocked) return false;
    if (this.backendAvailable === true) {
      const response = await this._request(`/v1/body-notes/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      });
      if (!response.ok || response.data?.deleted !== true) return false;
    }
    this._removedSessionIds.add(sessionId);
    this._sessions = this._sessions.filter((item) => item.session_id !== sessionId);
    for (const key of this._messages.keys()) {
      if (key.startsWith(`${sessionId}:`)) this._messages.delete(key);
    }
    this._notify();
    return true;
  }

  async addNote(sessionId, text) {
    if (this.mutationsLocked) return null;
    const trimmed = text.trim();
    if (!trimmed) return null;
    let remote = null;
    if (this.backendAvailable === true) {
      const response = await this._request(`/v1/body-notes/sessions/${encodeURIComponent(sessionId)}/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      if (!response.ok) return null;
      remote = response.data;
    }
    const now = new Date().toISOString();
    const note = remote || {
      note_id: `local-note-${Date.now()}`,
      session_id: sessionId,
      text: trimmed,
      created_at: now,
      updated_at: now,
    };
    const session = this._sessions.find((item) => item.session_id === sessionId);
    if (session) session.notes.push(note);
    this._notify();
    return clone(note);
  }

  async deleteNote(noteId) {
    if (this.mutationsLocked) return false;
    if (this.backendAvailable === true) {
      const response = await this._request(`/v1/body-notes/${encodeURIComponent(noteId)}`, { method: "DELETE" });
      if (!response.ok || response.data?.deleted !== true) return false;
    }
    for (const session of this._sessions) {
      session.notes = session.notes.filter((note) => note.note_id !== noteId);
    }
    this._notify();
    return true;
  }

  async sendInsight(sessionId, comparisonSessionIds, message) {
    if (this.mutationsLocked) return null;
    const scope = comparisonSessionIds.length ? "recent" : "current";
    const key = `${sessionId}:${scope}`;
    const items = this._messages.get(key) || [];
    items.push({ role: "user", text: message.trim() });
    this._messages.set(key, items);
    this._notify();

    const response = this.backendAvailable === true
      ? await this._request("/v1/body-notes/insight-turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session_id: sessionId,
            comparison_session_ids: comparisonSessionIds.slice(0, 10),
            message: message.trim(),
          }),
        })
      : { ok: false, data: null };
    const session = this.getSession(sessionId);
    if (!session) return null;
    const insight = response.ok ? response.data : this._fallbackInsight(session, comparisonSessionIds);
    items.push({
      role: "assistant",
      text: insight.dialogue,
      candidate: insight.insight_candidate,
      sources: insight.sources || [],
    });
    this._notify();
    return clone({
      ...insight,
      fallback: response.ok ? Boolean(insight.fallback) : true,
    });
  }

  clearTemporaryChats() {
    this._messages.clear();
    this._notify();
  }

  resetDemo() {
    this._sessions = clone(this._seed);
    this._messages.clear();
    this._removedSessionIds.clear();
    this._notify();
  }

  async _request(path, options = {}) {
    if (!this._fetch) return { ok: false, data: null, status: 0 };
    try {
      const response = await this._fetch(path, options);
      if (!response.ok) return { ok: false, data: null, status: response.status };
      if (response.status === 204) return { ok: true, data: {}, status: response.status };
      return { ok: true, data: await response.json(), status: response.status };
    } catch {
      return { ok: false, data: null, status: 0 };
    }
  }

  _fallbackInsight(session, comparisonSessionIds) {
    if (comparisonSessionIds.length) {
      return {
        dialogue: `我只参考了你确认的 ${comparisonSessionIds.length + 1} 次记录。时长和节奏并不总是一样，你更想先比较开始阶段，还是结束前的感受？`,
        insight_candidate: "近期几次里，我想先从较轻的节奏开始，再根据当下感受决定是否变化。",
        sources: [],
        fallback: true,
      };
    }
    return {
      dialogue: `只看这一次：${session.temperature.label}，${session.pressure.label}。这些只是当时的记录，不代表固定偏好。哪一段最接近你自己的感受？`,
      insight_candidate: "这一次，慢慢开始和清楚地收尾让我更容易听见自己的感受。",
      sources: [],
      fallback: true,
    };
  }
}

export const bodyNotes = new BodyNotesState();
