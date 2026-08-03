# Resource Manager Layout Design

**Status:** Approved 2026-08-03

## Goal

Make the local "Manage frequent sites" dialog usable and visually balanced at every supported control-window size, including macOS windows with `hiddenInset` traffic lights. The repair must preserve all existing shortcut-management behavior and keep data local.

## Scope

The work applies only to the control-window resource manager in `desktop/renderer/index.html`, `app.js`, and `styles.css`, plus its renderer contract tests. It does not alter browser routing rules, resource persistence, account data, engine behavior, or system network configuration.

## Layout model

The dialog is a constrained panel below the custom title bar rather than an unconstrained native top-layer sheet:

```
macOS title-bar safe area
┌─────────────────────────────────────────┐
│ Fixed dialog header: title + close       │
├─────────────────────────────────────────┤
│ Scrollable dialog body                   │
│   resource list                           │
│   selected-resource editor                │
│   validation message                      │
├─────────────────────────────────────────┤
│ Fixed action bar: New / Cancel / Save     │
└─────────────────────────────────────────┘
window-edge safe area
```

- The dialog reserves a top inset larger than the 38px renderer title bar, so it never covers macOS traffic lights.
- The panel uses `position: fixed` with explicit top, side, and bottom insets. It has a bounded maximum width, but its width derives from the available window width.
- The form becomes a vertical flex container with `min-height: 0`. Only the middle body scrolls; the header and action bar remain visible.
- The resource list is bounded inside that body. It scrolls when there are many shortcuts without pushing the editor or action bar out of view.

## Responsive behavior

At compact control-window widths (below 620px):

- Editor fields use one column.
- A resource row presents its name and route label as the primary line. Its action buttons wrap into a clearly aligned secondary action area instead of overflowing horizontally.
- The action bar uses two equal columns; the primary Save action remains distinct and always visible.

At wide widths:

- The dialog remains centered and capped at a readable width.
- The existing two-column editor fields remain available.
- Resource action controls may remain on the primary row when they fit, but retain the same grouping and spacing as compact mode.

## Interaction and accessibility

- Closing the dialog retains current behavior: close button dismisses it, Cancel clears the current edit selection, and Save uses the existing validation and local persistence path.
- Keyboard focus remains inside the native modal. The dialog body, not the page behind it, receives overflow scrolling.
- Existing labeled buttons and input labels remain unchanged. Any action grouping added to the markup is presentational and does not remove button text or accessible names.

## Failure handling

- A malformed or long shortcut name can be truncated only in the manager list; the editable field retains the full stored value.
- Validation errors appear in the scrollable body immediately above the persistent action bar.
- No overflow may obscure the close control, fields, validation message, or Save action at the minimum supported window size.

## Verification

- Add renderer contract coverage for the title-bar-safe fixed panel, separated scrollable body, persistent action bar, and compact action wrapping.
- Run the complete desktop test suite and JavaScript syntax checks.
- Launch the packaged macOS app and inspect the manager at the default 500×640 window and minimum 420×560 window, with both a short and expanded shortcut list.

## Non-goals

- No separate settings window or browser window.
- No cloud sync, import/export, telemetry, or user-data changes.
- No redesign of resource records, built-in shortcut policy, or routing behavior.
