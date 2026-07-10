// 全域事件匯流排：系統之間唯一的溝通管道。
// 用法：bus.on("enemy:died", fn) / bus.emit("enemy:died", { x, z })
export class EventBus {
  constructor() {
    this.listeners = new Map();
  }
  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event).push(fn);
    return () => this.off(event, fn);
  }
  off(event, fn) {
    const arr = this.listeners.get(event);
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }
  emit(event, payload) {
    const arr = this.listeners.get(event);
    if (!arr) return;
    for (const fn of [...arr]) fn(payload);
  }
}

export const bus = new EventBus();

// 常用捷徑：HUD 日誌
export const log = (msg, level = "info") => bus.emit("log", { msg, level });
