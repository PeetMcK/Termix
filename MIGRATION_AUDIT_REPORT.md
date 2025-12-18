# Comprehensive Migration Audit Report

Based on deep examination by 5 specialized agents, here are all findings organized by severity:

---

## CRITICAL ISSUES (Must Fix)

### 1. Hardcoded Dark Background Colors (14 instances)

| File | Line | Value | Should Be |
|------|------|-------|-----------|
| `main.tsx` | 82 | `#09090b` | `var(--bg-base)` |
| `Auth.tsx` | 871 | `#0e0e10` | `var(--bg-base)` |
| `TopNavbar.tsx` | 356, 547 | `#18181b` | `var(--bg-base)` |
| `LeftSidebar.tsx` | 595 | `#18181b` | `var(--bg-base)` |
| `SSHAuthDialog.tsx` | 45 | `#18181b` (default param) | `var(--bg-base)` |
| `AppView.tsx` | 299 | `#18181b` (fallback) | `var(--bg-base)` |
| `SimpleLoader.tsx` | 50 | `#18181b` (fallback) | `var(--bg-base)` |
| `TerminalPreview.tsx` | 34-35 | `#18181b`, `#f7f7f7` | Theme vars |
| `index.css` | 12 | `#09090b` in `:root` | Light color! |

### 2. Wrong Theme Hook Import

| File | Line | Issue |
|------|------|-------|
| `sonner.tsx` | 1 | Uses `useTheme` from `next-themes` instead of `@/components/theme-provider` |

### 3. Mobile Terminal Hardcoded Dark Theme

| File | Line | Issue |
|------|------|-------|
| `mobile/apps/terminal/Terminal.tsx` | 273 | `theme: { background: "#09090b", foreground: "#f7f7f7" }` |

### 4. Scrollbar CSS - Dark Only, No Light Mode

| File | Lines | Issue |
|------|-------|-------|
| `index.css` | 244-287 | All scrollbar colors are dark (`#303032`, `#18181b`, `#434345`) with NO light mode alternatives |

---

## HIGH PRIORITY (Should Fix)

### 5. Chart Widget Hardcoded Colors (Recharts)

**CpuWidget.tsx:**
| Line | Value | Purpose |
|------|-------|---------|
| 66 | `#374151` | Grid stroke |
| 69-70, 75-76 | `#9ca3af` | Axis stroke/tick |
| 80 | `#1f2937` | Tooltip background |
| 81 | `#374151` | Tooltip border |
| 83 | `#fff` | Tooltip text |
| 90 | `#60a5fa` | Line stroke (blue) |

**MemoryWidget.tsx:**
| Line | Value | Purpose |
|------|-------|---------|
| 75-76 | `#34d399` | Gradient stops |
| 79 | `#374151` | Grid stroke |
| 82-83, 88-89 | `#9ca3af` | Axis stroke/tick |
| 93 | `#1f2937` | Tooltip background |
| 94 | `#374151` | Tooltip border |
| 96 | `#fff` | Tooltip text |

**DiskWidget.tsx:**
| Line | Value | Purpose |
|------|-------|---------|
| 24, 60 | `#fb923c` | RadialBar fill (orange) |

### 6. Dashboard Icon Colors Hardcoded White

| File | Lines | Issue |
|------|-------|-------|
| `Dashboard.tsx` | 459, 488, 507, 531, 546, 563 | `color="#FFFFFF"` on icons |

### 7. Mobile Keyboard Theme - Entire File Hardcoded

**`kb-dark-theme.css`** (41 lines) - ALL hardcoded:
- `rgb(24, 24, 27)` - background
- `#bfbfbf` - text color
- `rgb(122, 122, 122)` - border
- `rgba(0, 0, 0, 0.5)` - button background
- `rgba(83, 83, 83, 0.5)` - active states

### 8. Terminal Scrollbar Colors (Desktop & Mobile)

| File | Lines | Values |
|------|-------|--------|
| `desktop/apps/terminal/Terminal.tsx` | 485-493 | `rgba(180,180,180,0.7)`, `rgba(120,120,120,0.9)` |
| `mobile/apps/terminal/Terminal.tsx` | 485-493 | Same values |

---

## MEDIUM PRIORITY (Consider Fixing)

### 9. Tailwind `dark:` Variants in Components

These use explicit `dark:` variants instead of semantic tokens:

| File | Examples |
|------|----------|
| `input.tsx` | `dark:bg-input/30`, `dark:aria-invalid:ring-destructive/40` |
| `button.tsx` | `dark:bg-input/30`, `dark:border-input`, `dark:hover:bg-input/50` |
| `checkbox.tsx` | `dark:bg-input/30`, `dark:data-[state=checked]:bg-primary` |
| `select.tsx` | `dark:bg-input/30`, `dark:hover:bg-input/50` |
| `switch.tsx` | `dark:data-[state=unchecked]:bg-input/80` |
| `tabs.tsx` | `dark:data-[state=active]:bg-input/30` |

### 10. Hardcoded Light/Dark Pairs (Not Semantic)

| File | Classes | Should Be |
|------|---------|-----------|
| `FileManagerGrid.tsx` | `bg-white dark:bg-gray-800` | `bg-canvas` |
| `FileViewer.tsx` | `bg-gray-100 dark:bg-gray-900` | `bg-elevated` |
| `CredentialViewer.tsx` | `bg-zinc-100 dark:bg-zinc-800` (multiple) | Semantic token |

### 11. Black Overlays

| File | Line | Value | Consider |
|------|------|-------|----------|
| `dialog.tsx` | 39 | `bg-black/50` | `bg-overlay` token |
| `sheet.tsx` | 37 | `bg-black/50` | `bg-overlay` token |
| `FileViewer.tsx` | 880 | `#000` (video bg) | May be intentional |

### 12. Duplicated Theme Detection Logic

| File | Lines | Issue |
|------|-------|-------|
| `Auth.tsx` | 826-827, 830, 1372-1373, 1376 | Same `isDark` calculation repeated 4 times |

---

## LOW PRIORITY / INFO

### 13. Unused Semantic Variables

Defined in `@theme inline` but never used:
- `--color-button`, `--color-interact`, `--color-light`, `--color-subtle`
- `--color-hover`, `--color-hover-alt`, `--color-pressed`
- `--color-foreground-secondary`, `--color-foreground-subtle`
- All `--color-dark-*` legacy variables

### 14. Legitimate `dark:` Usage (No Change Needed)

- `TunnelObject.tsx` - Properly uses `text-green-600 dark:text-green-400` pattern
- `theme-provider.tsx` - Core theme logic, working correctly

### 15. Terminal Themes Constants

`terminal-themes.ts` has 441 color definitions - these are properly scoped theme presets and should NOT be changed.

---

## Summary Statistics

| Category | Count |
|----------|-------|
| Hardcoded dark hex colors | 30+ |
| Files needing migration | 18 |
| Hardcoded rgba values | 12 |
| Chart colors to fix | 15 |
| CSS files needing work | 2 |
| Unused semantic tokens | 12 |

---

## Discussion Points

1. **Priority Order**: Should we fix critical issues first (backgrounds, scrollbars) or do a comprehensive pass?

2. **Chart Colors**: Create CSS variables for chart theming, or accept hardcoded accent colors?

3. **Mobile Keyboard**: Refactor `kb-dark-theme.css` to use CSS vars, or create separate light/dark files?

4. **Shadcn Components**: The `dark:` variants in `components/ui/` - leave as-is (they work with the theme system) or migrate to semantic tokens?

5. **Scrollbars**: Need both light and dark scrollbar styling in `index.css`

6. **Unused Variables**: Remove the 12 unused semantic tokens, or implement them?
