import { assetPath } from "../utils/assetPath";

export type OceanIconName =
  | "birthday"
  | "graduate"
  | "heart"
  | "menu"
  | "nav-home"
  | "nav-leisure"
  | "nav-living"
  | "nav-palace"
  | "nav-study"
  | "next"
  | "settings";

const iconFiles: Record<OceanIconName, string> = {
  birthday: "birthday.svg",
  graduate: "graduate.svg",
  heart: "heart.svg",
  menu: "menu.svg",
  "nav-home": "nav-home-main.svg",
  "nav-leisure": "nav-leisure.svg",
  "nav-living": "nav-living.svg",
  "nav-palace": "nav-palace.svg",
  "nav-study": "nav-study.svg",
  next: "next.svg",
  settings: "settings.svg",
};

interface OceanIconProps {
  className?: string;
  name: OceanIconName;
}

export function OceanIcon({ className, name }: OceanIconProps) {
  if (name.startsWith("nav-")) {
    return (
      <span aria-hidden="true" className={`${className ?? ""} ocean-icon-${name}`}>
        {name === "nav-home" ? (
          <>
            <img src={assetPath("assets/icons/nav-home-main.svg")} />
            <img src={assetPath("assets/icons/nav-home-roof.svg")} />
            <img src={assetPath("assets/icons/nav-home-smile.svg")} />
          </>
        ) : <img src={assetPath(`assets/icons/${iconFiles[name]}`)} />}
      </span>
    );
  }
  const iconUrl = assetPath(`assets/icons/${iconFiles[name]}`);
  return <span aria-hidden="true" className={`ocean-glyph ${className ?? ""}`} style={{ WebkitMaskImage: `url(${iconUrl})`, maskImage: `url(${iconUrl})` }} />;
}
