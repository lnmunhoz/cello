// Every action the ⌘K bar offers (CEL-43), in one place: what each is called, the words that find it
// and its shortcut. Key chords (G R, C) will run the same list by id. Running them is useActions.ts.
import { matchesAll, searchTerms, wordPrefixRanges, type Range } from "@cello/text/search"
import {
  BookOpenIcon,
  ClipboardCheckIcon,
  FolderIcon,
  LayoutGridIcon,
  LayoutListIcon,
  MoonIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PlusIcon,
  Settings2Icon,
  SettingsIcon,
  SunIcon,
  type LucideIcon,
} from "lucide-react"
import { SIDEBAR_SHORTCUT } from "../app/sidebarState.ts"
import { LAYOUT_NAMES, type BarLayout } from "./layout.ts"

export type ActionId =
  | "new-task"
  | "review"
  | "issues"
  | "docs"
  | "project-settings"
  | "switch-project"
  | "switch-workspace"
  | "sidebar"
  | "theme"
  | "layout"
  | "settings"

export interface ActionSpec {
  readonly id: ActionId
  readonly label: string
  readonly icon: LucideIcon
  /** More words that find it. */
  readonly keywords: ReadonlyArray<string>
  /** Its keys anywhere in the app, for `formatShortcut` ("mod+b"). */
  readonly shortcut?: string
  /** A short note beside it: "3 waiting". */
  readonly meta?: string
  /** It opens a list in the bar (pick a project) instead of running at once. */
  readonly opensList?: boolean
}

export interface ActionContext {
  /** The project on screen, else the workspace's first; null when there's none. */
  readonly project: { readonly name: string } | null
  /** Packets waiting on the Review page. */
  readonly waiting: number
  readonly workspaces: number
  readonly dark: boolean
  readonly layout: BarLayout
  /** What's typed: "Create task" offers it as the title. */
  readonly typed: string
}

export const actionSpecs = (ctx: ActionContext): ActionSpec[] => {
  const where = ctx.project ? ` in ${ctx.project.name}` : ""
  const title = ctx.typed.trim()
  const other: BarLayout = ctx.layout === "peek" ? "palette" : "peek"
  return [
    ...(ctx.project
      ? [{
        id: "new-task" as const,
        label: title ? `Create task “${title}”${where}` : `Create task${where}…`,
        icon: PlusIcon,
        keywords: ["new", "add", "issue", "create", "task"],
        opensList: title === "",
      }]
      : []),
    { id: "review", label: "Go to Review", icon: ClipboardCheckIcon, keywords: ["packets", "inbox", "approve"], ...(ctx.waiting > 0 ? { meta: `${ctx.waiting} waiting` } : {}) },
    ...(ctx.project
      ? [
        { id: "issues" as const, label: `Go to ${ctx.project.name} issues`, icon: LayoutGridIcon, keywords: ["board", "list", "tasks"] },
        { id: "docs" as const, label: `Go to ${ctx.project.name} docs`, icon: BookOpenIcon, keywords: ["pages", "specs", "documents"] },
        { id: "project-settings" as const, label: `Go to ${ctx.project.name} settings`, icon: Settings2Icon, keywords: ["preferences", "labels", "testing", "profile", "waking", "merging"] },
      ]
      : []),
    { id: "switch-project", label: "Switch project…", icon: FolderIcon, keywords: ["open", "project", "go"], opensList: true },
    ...(ctx.workspaces >= 2 ? [{ id: "switch-workspace" as const, label: "Switch workspace…", icon: FolderIcon, keywords: ["workspace"], opensList: true }] : []),
    { id: "sidebar", label: "Toggle sidebar", icon: PanelLeftIcon, keywords: ["collapse", "expand", "hide", "show"], shortcut: SIDEBAR_SHORTCUT },
    { id: "theme", label: ctx.dark ? "Switch to light theme" : "Switch to dark theme", icon: ctx.dark ? SunIcon : MoonIcon, keywords: ["appearance", "theme", "mode", "dark", "light"] },
    {
      id: "layout",
      label: `Search with the ${LAYOUT_NAMES[other]} layout`,
      icon: other === "peek" ? PanelRightIcon : LayoutListIcon,
      keywords: ["layout", "search", "bar", "preview", "palette", "peek"],
    },
    { id: "settings", label: "Open settings", icon: SettingsIcon, keywords: ["preferences", "statuses"] },
  ]
}

/**
 * The actions whose label or keywords start with every word typed (`>` in front is ignored), with the
 * label's matches; all of them when nothing is typed. "Create task “…”" carries what's typed in its
 * label, so it's always among them.
 */
export const matchActions = (specs: ReadonlyArray<ActionSpec>, query: string): Array<ActionSpec & { readonly titleRanges: ReadonlyArray<Range> }> => {
  const terms = searchTerms(query.replace(/^\s*>/, ""))
  return specs.filter((a) => matchesAll([a.label, ...a.keywords], terms)).map((a) => ({ ...a, titleRanges: wordPrefixRanges(a.label, terms) }))
}

/** `>` first: only actions, no search. */
export const isActionsOnly = (query: string): boolean => query.trimStart().startsWith(">")
