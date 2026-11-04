import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const base = (size: number, props: IconProps) => ({
  viewBox: "0 0 24 24",
  width: size,
  height: size,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...props,
});

export const ChevronDown = ({ size = 14, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);
export const ChevronRight = ({ size = 14, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);
export const Search = ({ size = 15, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
);
export const Folder = ({ size = 16, ...p }: IconProps) => (
  <svg {...base(size, p)} strokeWidth={1.7}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);
export const FileText = ({ size = 16, ...p }: IconProps) => (
  <svg {...base(size, p)} strokeWidth={1.7}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </svg>
);
export const Plus = ({ size = 15, ...p }: IconProps) => (
  <svg {...base(size, p)} strokeWidth={2}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const Book = ({ size = 16, ...p }: IconProps) => (
  <svg {...base(size, p)} strokeWidth={1.7}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);
export const Moon = ({ size = 16, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
);
export const Sun = ({ size = 16, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
export const Monitor = ({ size = 16, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </svg>
);
export const PanelRight = ({ size = 16, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M15 4v16" />
  </svg>
);
export const PanelLeft = ({ size = 16, ...p }: IconProps) => (
  <svg {...base(size, p)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </svg>
);
export const FolderOpen = ({ size = 16, ...p }: IconProps) => (
  <svg {...base(size, p)} strokeWidth={1.7}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H6.5a2 2 0 0 0-1.9 1.4L3 17z" />
    <path d="M3 17l1.6-5.6A2 2 0 0 1 6.5 10H22l-2.2 7.4A2 2 0 0 1 17.9 19H5a2 2 0 0 1-2-2z" />
  </svg>
);
export const X = ({ size = 14, ...p }: IconProps) => (
  <svg {...base(size, p)} strokeWidth={2}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
