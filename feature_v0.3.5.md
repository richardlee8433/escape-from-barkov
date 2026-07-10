# 🧾 Escape from Barkov — Feature Log
## Version: v0.3.5
**Theme:** Enemy AI + Audio System Upgrade

### 🧠 Enemy AI Upgrade
- **三階段行為邏輯完成**：
  - `patrol`（巡邏）：隨機小幅移動，未發現玩家時維持警戒。  
  - `chase`（追擊）：發現玩家後進入追擊模式並持續開火。  
  - `search`（搜尋）：若追擊中失去玩家視線，前往最後看到的位置繼續搜尋。  
- **視野系統（FOV）**  
  - 僅在「玩家於可視範圍（70°）」且「距離 < 80」內才可偵測。  
- **戰鬥邏輯優化**  
  - 看到玩家後才會射擊，並在「失去視線 2 秒」後轉為搜尋。  
  - 難度隨時間與擊殺數提升：移動速度與射速最高達 2.5 倍。  
  - 被子彈命中時會短暫退後並播放低音「嘎…」音效。  
- **生成邏輯調整**  
  - 敵人不再密集生成於玩家附近。  
  - 每隻敵人距離玩家 > 50、敵人間距離 > 30 才允許生成，分布更平均。  

### 🔊 Audio System Overhaul
#### Sound Effects (using `AudioContext` + `Oscillator`)
| 角色 | 事件 | 音效 | 類型 |
|------|------|------|------|
| Player | 受傷 | 短促「汪一聲」 | `playerHurt()` |
| Player | 使用醫療包 | 雙音階「回復提示」 | `heal()` |
| Enemy | 發現玩家 | 高音「嘎！」 | `enemyAlert()` |
| Enemy | 被打到 | 低音「嘎…」 | `enemyHurt()` |
| Enemy | 死亡 | 下降音階「哇→啊」 | `enemyDie()` |
| System | 開局提示、撿拾、死亡等 | 各自有獨立 SFX | `sfx.*` |

### 🎵 Background Music (BGM)
- 改為使用 **MP3 音樂檔播放**，取代原本的 8-bit 合成音。
- 新增 `startBgm()` / `stopBgm()` 系統：
  - 支援在遊戲中播放 `./ass/audio/bgm.mp3`
  - 每次重新啟動都會重建音樂實例，避免 Chrome 掛起無法重新播放。
- 新增 **BGM 控制鍵**
  - `M` 鍵切換音樂 ON / OFF（會即時重新建立播放）。
  - 關閉 BGM 時釋放音樂實例以節省資源。
- BGM 在：
  - 遊戲開始時自動播放。  
  - 玩家死亡或逃離成功時自動停止。  

### 🧩 Gameplay & Mechanics
- **子彈速度與射程強化**  
  - 玩家子彈速度：`110`（原 34）  
  - 敵人子彈速度：`70`（原 22）  
  - 射程延長至 `120`，改善子彈視覺延遲問題。  
- **敵人與玩家之間的距離維護**  
  - 自動避免敵人疊在一起或穿過主角。  
- **主角出生 / 終點設置**  
  - 玩家在「道路起點」生成，終點（Exit）在道路另一側。  
  - 完成逃離後顯示勝利畫面（含模型授權資訊）。  

### 🏕 Environment
- **地形 / 森林 / 道路系統延續 v0.3.4**：  
  - 地形使用改良版 FBM 噪聲生成。  
  - 樹木、岩石與灌木沿邊界自然分佈。  
  - 道路曲線（S 型）生成函式保留並新增終點出口門。  
- **Sky Dome**  
  - 新增柔和天空漸層 Shader，整體氛圍更自然。  

### ⚙️ Technical Enhancements
- 音樂播放修正：`bgmEnabled` 全域唯一，避免重複宣告與狀態錯亂。  
- 按鍵綁定統一：所有 `keydown` 事件改為單一事件集中管理。  
- `AudioContext` 自動 resume，確保首次點擊啟動時音樂可播放。  
- `window.__start()` 公開啟動方法，避免 Start 按鈕無效。  

### 🧩 Version Metadata
| 項目 | 說明 |
|------|------|
| Version | **v0.3.5** |
| Focus | Enemy AI + Audio Pass |
| Release Date | 2025-11 |
| Engine | Three.js 0.164.1 |
| Background Music | `bgm.mp3` (forest theme) |
| Notable Models | Corgi (ofekyovel, CC-BY 4.0), Duck (rbreve, CC-BY 4.0) |
