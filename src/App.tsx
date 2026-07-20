import { type ChangeEvent, type CSSProperties, useEffect, useMemo, useState } from "react";
import { FirstRunWizard } from "./components/FirstRunWizard";
import { HomeScreen } from "./components/HomeScreen";
import { LeisureRoom } from "./components/LeisureRoom";
import { LivingRoom } from "./components/LivingRoom";
import { OceanIcon } from "./components/OceanIcon";
import { PalaceRoom } from "./components/PalaceRoom";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { StudyRoom } from "./components/StudyRoom";
import { usePersistentState } from "./hooks/usePersistentState";

type RoomId = "study" | "living" | "home" | "leisure" | "palace";
type ThemeId = "ocean" | "peach" | "mono" | "mint";

const rooms: { id: RoomId; label: string }[] = [
  { id: "study", label: "书房" },
  { id: "living", label: "客厅" },
  { id: "home", label: "家" },
  { id: "leisure", label: "休闲" },
  { id: "palace", label: "宫殿" },
];

const themeOptions: Array<{ id: ThemeId; label: string; note: string; colors: string[] }> = [
  { id: "ocean", label: "潮汐蓝", note: "蓝紫 × 珊瑚", colors: ["#edf2f8", "#fafbff", "#8396be", "#c8ccff", "#e8a18e"] },
  { id: "peach", label: "珊瑚暮色", note: "深褐 × 珊瑚粉", colors: ["#f7efec", "#fffaf8", "#634c47", "#d58e82", "#f3ccc5"] },
  { id: "mono", label: "黑白信号", note: "中性灰 × 信号红", colors: ["#efefef", "#ffffff", "#646a70", "#d8dadd", "#d2534d"] },
  { id: "mint", label: "薄荷薰衣草", note: "薄荷 × 薰衣草", colors: ["#eef6f3", "#fbfffd", "#83b7a5", "#cbe5dc", "#9d90c9"] },
];

const themeCanvas: Record<ThemeId, string> = {
  ocean: "#edf2f8",
  peach: "#f7efec",
  mono: "#efefef",
  mint: "#eef6f3",
};
const themeNightCanvas: Record<ThemeId, string> = {
  ocean: "#8396be",
  peach: "#765852",
  mono: "#5f6266",
  mint: "#607d77",
};

function App() {
  const [room, setRoom] = usePersistentState<RoomId>("ocean:room", "home");
  const [livingNight, setLivingNight] = usePersistentState("ocean:living:night", false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = usePersistentState<ThemeId>("ocean:theme", "ocean");
  const [wallpaperUrl, setWallpaperUrl] = useState("");
  const [wallpaperName, setWallpaperName] = useState("");
  const [wallpaperOpacity, setWallpaperOpacity] = usePersistentState("ocean:wallpaper:opacity", 100);
  const [onboarded, setOnboarded] = usePersistentState("ocean:onboarded", false);
  const pageTitle = useMemo(() => rooms.find((item) => item.id === room)?.label ?? "家", [room]);
  useEffect(() => {
    const color = room === "living" && livingNight ? themeNightCanvas[theme] : themeCanvas[theme];
    document.documentElement.style.backgroundColor = color;
    document.body.style.backgroundColor = color;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);
  }, [livingNight, room, theme]);
  useEffect(() => {
    const roomIds: RoomId[] = ["study", "living", "home", "leisure", "palace"];
    const requested = new URLSearchParams(window.location.search).get("room") as RoomId | null;
    if (requested && roomIds.includes(requested)) setRoom(requested);
    const onMessage = (event: MessageEvent) => {
      const next = event.data?.type === "ocean:navigate" ? event.data.room as RoomId : undefined;
      if (next && roomIds.includes(next)) setRoom(next);
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, [setRoom]);
  const customWallpaperStyle = wallpaperUrl ? {
    "--wallpaper-image": `url("${wallpaperUrl}")`,
    "--living-wallpaper-image": `url("${wallpaperUrl}")`,
    "--wallpaper-opacity": String(wallpaperOpacity / 100),
    "--wallpaper-size": "cover",
  } as CSSProperties : undefined;
  const chooseWallpaper = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setWallpaperUrl(reader.result);
      setWallpaperName(file.name);
      setWallpaperOpacity(100);
    };
    reader.readAsDataURL(file);
  };

  return (
    <main className={`ocean-app theme-${theme}`} style={customWallpaperStyle}>
      <section className={`ocean-shell room-${room} ${room === "living" && livingNight ? "living-night" : ""}`} aria-label="Ocean 房子">
        <header className="app-header">
          <button aria-label="打开皮肤侧边栏" className="icon-button menu-button" onClick={() => setSidebarOpen(true)}>
            <OceanIcon name="menu" />
          </button>
          <span className="app-kicker">FISH WITH OCTOPUS</span>
          <button aria-label="打开设置" className="icon-button settings-button" onClick={() => setSettingsOpen(true)}>
            <OceanIcon name="settings" />
          </button>
        </header>

        {room === "home" ? <HomeScreen />
          : room === "living" ? <LivingRoom isNight={livingNight} onNightChange={setLivingNight} />
          : room === "study" ? <StudyRoom />
          : room === "leisure" ? <LeisureRoom />
          : room === "palace" ? <PalaceRoom />
          : (
            <section className="room-placeholder" aria-label={`${pageTitle}正在建设`}>
              <p className="eyebrow">{pageTitle.toUpperCase()}</p>
              <h1>{pageTitle}</h1>
              <p>这个房间的结构已经准备好，接下来会按对应的 Figma 画板逐屏复原。</p>
            </section>
          )}

        <nav aria-label="房间导航" className="room-nav">
          {rooms.map((item) => (
            <button
              aria-label={item.label}
              className={`room room-${item.id} ${item.id === room ? "active" : ""}`}
              key={item.id}
              onClick={() => setRoom(item.id)}
            >
              <span className="room-group" aria-hidden="true" />
            </button>
          ))}
          <span aria-hidden="true" className="room-nav-labels">
            {rooms.map((item) => (
              <span
                className={`room-nav-label room-nav-label-${item.id} ${item.id === room ? "active" : ""}`}
                key={`label-${item.id}`}
              />
            ))}
          </span>
        </nav>

        {sidebarOpen && (
          <div className="drawer-backdrop" onClick={() => setSidebarOpen(false)} role="presentation">
          <aside className="drawer theme-drawer drawer-left" aria-label="皮肤侧边栏" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-header"><h2>皮肤</h2><button className="plain-button" onClick={() => setSidebarOpen(false)}>×</button></div>
            <p>配色会统一改变界面层级；壁纸独立管理，不随主题染色。</p>
            <div className="theme-options">
              {themeOptions.map((item) => (
                <button className={theme === item.id ? "theme-option selected" : "theme-option"} key={item.id} onClick={() => setTheme(item.id)}>
                  <span className="theme-option-copy"><strong>{item.label}</strong><small>{item.note}</small></span>
                  <span className="theme-palette" aria-hidden="true">{item.colors.map((color) => <i key={color} style={{ background: color }} />)}</span>
                </button>
              ))}
            </div>
            <label className="upload-wallpaper"><input accept="image/*" onChange={chooseWallpaper} type="file" /><span>{wallpaperName || "从系统图片上传壁纸"}</span></label>
            {wallpaperUrl && <div className="wallpaper-controls"><label><span>壁纸透明度</span><output>{wallpaperOpacity}%</output><input aria-label="壁纸透明度" max="100" min="0" onChange={(event) => setWallpaperOpacity(Number(event.target.value))} type="range" value={wallpaperOpacity} /></label><small>图片按比例覆盖画布，不改变原始宽高比。</small><button onClick={() => { setWallpaperUrl(""); setWallpaperName(""); }}>移除自定义壁纸</button></div>}
          </aside>
          </div>
        )}

        {settingsOpen && <div className="drawer-backdrop" onClick={() => setSettingsOpen(false)} role="presentation"><SettingsDrawer onClose={() => setSettingsOpen(false)} /></div>}
        {!onboarded && <FirstRunWizard onUseMock={() => setOnboarded(true)} onConnect={() => { setOnboarded(true); setSettingsOpen(true); }} />}
      </section>
    </main>
  );
}

export default App;
