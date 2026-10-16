import * as THREE from "three";
import { BAL } from "../config/balance.js";
import { EnemyBrain } from "../ai/EnemyBrain.js";
import { Animator } from "../render/Animator.js";

const E = BAL.enemy;

export class Enemy {
  constructor(scene, assets, collision, x, z) {
    this.brain = new EnemyBrain(this, collision);

    this.root = new THREE.Group();
    this.root.position.set(x, 0, z);
    const model = assets.instantiate("duck", E.height, { center: true });
    this.root.add(model);
    scene.add(this.root);
    this.anim = new Animator(model, assets.clips("duck"));
    this.anim.play("Idle");
    this.prevState = this.brain.state;

    const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
    this.hitR = Math.max(size.x, size.z) * 0.6;
  }

  get pos() {
    return this.root.position;
  }

  update(dt, player, difficulty, collision, combat) {
    const intent = this.brain.update(dt, player.pos, difficulty);

    if (intent.move) {
      const bx = this.pos.x, bz = this.pos.z;
      collision.move(this.pos, intent.move.x * dt, intent.move.z * dt, this.hitR * 0.8);
      // 告訴 brain 實際走了多少(卡住時它會換方向)
      this.brain.reportProgress(Math.hypot(intent.move.x, intent.move.z) * dt, Math.hypot(this.pos.x - bx, this.pos.z - bz), dt);
    } else {
      this.brain.reportProgress(0, 0, dt);
    }
    if (intent.faceYaw !== null) {
      let diff = intent.faceYaw - this.root.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.root.rotation.y += diff * Math.min(1, dt * 8);
    }

    // 出手時機完全由 brain 決定（含冷卻、前搖、落空判定),這裡只負責執行
    if (intent.attack) combat.peck(this, player);

    // 動作:剛進入前搖就播啄擊(後仰蓄力 70%,剛好在前搖結束時往前啄);其餘依移動速度
    if (this.brain.state === "windup" && this.prevState !== "windup") this.anim.playOnce("Peck", E.windupTime / 0.7);
    this.prevState = this.brain.state;
    const speed = intent.move ? Math.hypot(intent.move.x, intent.move.z) : 0;
    if (speed < 0.3) this.anim.play("Idle");
    else if (speed < 4) this.anim.play("Walk", Math.min(1.6, Math.max(0.6, speed / 2)));
    else this.anim.play("Run", speed / 5.5);
    this.anim.update(dt);
  }

  // 中彈退後:走一般的移動流程(分小步、會被擋),不會被打穿柵欄或打進石頭裡
  knockback(fromPos, collision) {
    const away = this.pos.clone().sub(fromPos).setY(0).normalize().multiplyScalar(E.knockback);
    collision.move(this.pos, away.x, away.z, this.hitR * 0.8);
  }

  dispose(scene) {
    scene.remove(this.root);
  }
}
