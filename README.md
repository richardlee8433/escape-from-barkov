# 🐕 Escape from Barkov

A top-down extraction shooter where a corgi fights its way through a forest full of armed ducks — inspired by the look and feel of *Escape from Duckov*. Built with [Three.js](https://threejs.org/), no game engine, no bundler.

## Play

```bash
npm install
npx serve . -l 5173
```

Then open **http://localhost:5173/** in your browser — the root redirects to the current version.

> The legacy prototype (v0.3.5, single-file) is at `/v0.3.5.html`. The visual style prototype is at `/proto/`.
> Deterministic gameplay tests run in the browser at `/game/tests/run.html`.

## Controls

| Key | Action |
|-----|--------|
| `W A S D` | Move |
| Mouse | Aim |
| Left Click | Shoot foam darts |
| `E` | Pick up items |
| `1` `2` `3` | Use hotbar item |
| `F` | Extract at the exit gate |
| `M` | Toggle music |

**Goal:** fight (or sneak) your way from the west spawn to the EXIT gate on the east side of the map, cross the ravine bridge, and press `F` to extract. Enemies get faster and shoot quicker the longer you survive and the more you kill.

## Project structure

```
game/            v0.4 — the current game (modular rebuild)
  index.html     UI shell
  src/
    config/      All balance numbers in one file (balance.js)
    core/        Event bus, fixed-timestep game loop, input, asset loader
    render/      Post-processing (tilt-shift, color grade, vignette, bloom), camera rig
    world/       Painted ground, instanced grass (55k blades), world builder
    entities/    Player, Enemy, ItemDrop
    ai/          Enemy state machine (patrol / chase / search) with a real FOV
    systems/     Collision, combat, spawner, inventory, exit
    audio/       Synthesized SFX + BGM
    ui/          HUD (event-driven), screens
proto/           Duckov-style visual prototype + shared 3D assets
index.html       Redirects to game/ (the current version)
v0.3.5.html      Legacy v0.3.5 single-file version (kept for reference)
```

### Architecture notes

- **Event bus** — systems never call each other directly; enemies emit `enemy:died`, and loot drops, SFX, kill counters, and the HUD each subscribe independently.
- **Fixed timestep** — logic ticks at a constant 60 Hz regardless of frame rate.
- **Data-driven balance** — every speed, range, drop rate, and difficulty curve lives in `game/src/config/balance.js`.
- **Measured, not assumed** — the bridge walk height is raycast-sampled from the actual model, and collision radii derive from real mesh footprints.

## Credits

| Asset | Author | License |
|-------|--------|---------|
| Corgi model | [ofekyovel](https://sketchfab.com/ofekyovel) | CC-BY 4.0 |
| Voxel duck model | [rbreve](https://sketchfab.com/rbreve) | CC-BY 4.0 |
| Environment, pickups & dart models | [Kenney](https://kenney.nl/) (Nature Kit, Survival Kit, Platformer Kit, Blaster Kit) | CC0 |

Built with Three.js r164.
