import * as THREE from "three";

// 角色動畫播放器:包一層 AnimationMixer。
// 循環動作(Idle / Walk / Run / Dig)用 play() 交叉淡入;
// 單次動作(鴨子的 Peck)用 playOnce(),播完自動回到目前的循環動作。
export class Animator {
  constructor(model, clips) {
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = new Map();
    for (const clip of clips || []) this.actions.set(clip.name, this.mixer.clipAction(clip));
    this.current = null;
    this.oneShot = null;
    this.mixer.addEventListener("finished", (e) => {
      if (e.action !== this.oneShot) return;
      this.oneShot = null;
      e.action.fadeOut(0.15);
      if (this.current) this.current.reset().fadeIn(0.15).play();
    });
  }

  has(name) {
    return this.actions.has(name);
  }

  // 切換循環動作;timeScale 讓腳步頻率跟上實際移動速度
  play(name, timeScale = 1, fade = 0.2) {
    const a = this.actions.get(name);
    if (!a) return;
    a.timeScale = timeScale;
    if (a === this.current) return;
    if (this.oneShot) {
      this.current = a; // 單次動作播完後才接上
      return;
    }
    a.reset().setLoop(THREE.LoopRepeat, Infinity).play();
    if (this.current) this.current.crossFadeTo(a, fade, false);
    this.current = a;
  }

  // 單次動作:duration 指定總長(秒),會自動調整播放速度
  playOnce(name, duration) {
    const a = this.actions.get(name);
    if (!a) return;
    a.reset().setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = false;
    a.timeScale = duration ? a.getClip().duration / duration : 1;
    a.play();
    if (this.current) this.current.crossFadeTo(a, 0.08, false);
    this.oneShot = a;
  }

  update(dt) {
    this.mixer.update(dt);
  }
}
