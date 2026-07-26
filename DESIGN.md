---
name: Pagelea
description: A calm, local-first PDF workbench that keeps the document in control.
colors:
  ink: "#17221e"
  muted: "#68726e"
  paper: "#fbfaf6"
  cream: "#f2eadf"
  cream-deep: "#e8dac8"
  mint: "#c8f2df"
  green: "#0f9f6e"
  green-dark: "#087a54"
  blue: "#2d6fe8"
  line: "#dfe5df"
  surface: "#ffffff"
typography:
  display:
    fontFamily: "Bricolage Grotesque, sans-serif"
    fontSize: "clamp(2.5rem, 6vw, 4.7rem)"
    fontWeight: 750
    lineHeight: 0.96
    letterSpacing: "-0.04em"
  body:
    fontFamily: "Manrope, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  title:
    fontFamily: "Manrope, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 820
    lineHeight: 1.25
  label:
    fontFamily: "Manrope, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 760
    lineHeight: 1.3
rounded:
  sm: "12px"
  md: "20px"
  lg: "34px"
  control: "14px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: "0 18px"
    height: "46px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 18px"
    height: "46px"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "9px 10px"
---

# Design System: Pagelea

## Overview

**Creative North Star: "The Quiet Workbench"**

Pagelea pairs an approachable public identity with restrained professional
product chrome. Marketing surfaces may use the expressive Bricolage Grotesque
display face and tactile shapes; the editor itself becomes quieter, denser, and
predictable so the PDF remains the dominant object.

The workbench uses familiar tool, page, canvas, and property regions. On large
screens these regions can remain visible together. On narrow or touch-first
screens they become explicit drawers and bottom sheets rather than a long stack
below the document. It rejects a document editor embedded inside a
marketing-page card or constrained canvas.

**Key Characteristics:**

- Local-first confidence with restrained green state accents.
- Neutral layered surfaces that separate navigation from document content.
- Familiar editor geometry and consistent 4-pixel spacing increments.
- Structural responsive changes instead of scaled-down desktop chrome.
- Fast state transitions with no decorative product animation.

## Colors

The palette is a restrained green-tinted neutral system with blue reserved for
active document selection.

### Primary

- **Workbench Ink:** the dominant action and high-contrast text colour.
- **Local Green:** success, privacy, ready states, and primary active accents.
- **Selection Blue:** text targets, selection outlines, and precision handles
  only.

### Neutral

- **Pagelea Paper:** the public-site background and warm empty-state canvas.
- **Clean Surface:** toolbars, panels, fields, and raised controls.
- **Workbench Line:** quiet structural dividers and control borders.
- **Muted Ink:** secondary copy and non-critical status text.

### Named Rules

**The Document Colour Rule.** Green communicates readiness and privacy; blue
communicates document selection. Never swap those meanings or use either as
decoration.

**The Quiet Chrome Rule.** Editor chrome stays neutral. Saturated colour may
occupy no more than active controls, focused targets, and meaningful status
indicators.

## Typography

**Display Font:** Bricolage Grotesque (with sans-serif fallback)

**Body Font:** Manrope (with sans-serif fallback)
**Label Font:** Manrope (with sans-serif fallback)

**Character:** Bricolage gives public and first-run moments a recognisable
Pagelea voice. Manrope carries every dense product label, field, toolbar, and
status because consistency and legibility outrank expression inside the task.

### Hierarchy

- **Display:** reserved for marketing and the editor's empty state.
- **Headline:** used for first-run instructions, never for routine toolbar
  labels.
- **Title:** compact document and panel titles at high weight.
- **Body:** readable explanatory and error copy, capped near 70 characters
  where prose is present.
- **Label:** concise controls and status, written in sentence case.

### Named Rules

**The Task-Type Rule.** Display typography disappears once a document is open.
Every working control uses the body family at fixed product-interface sizes.

## Elevation

Pagelea combines tonal layering with restrained ambient shadows. The PDF page
is the most elevated object in the editor; fixed chrome uses dividers and
surface tone rather than decorative floating cards.

### Shadow Vocabulary

- **Control shadow:** low ambient depth for actionable white controls.
- **Document shadow:** the strongest shadow, used only beneath the rendered PDF
  page.
- **Overlay shadow:** structural depth for a drawer or bottom sheet above the
  canvas.

### Named Rules

**The Page-First Elevation Rule.** Nothing in the workbench may cast a stronger
resting shadow than the PDF page except an open modal sheet or drawer.

## Components

### Buttons

- **Shape:** gently curved controls using the shared 14-pixel control radius.
- **Primary:** dark ink surface, paper text, and a minimum height of 44 pixels.
- **Hover / Focus:** subtle tonal shift for hover and a visible blue focus
  outline; active state must read without motion.
- **Secondary / Ghost:** white or transparent neutral surfaces with quiet
  borders. Icon-only controls keep an accessible name.

### Chips

- **Style:** compact status pills use a pale semantic tint and readable dark
  text.
- **State:** selected tools use mint plus a border; inactive tools remain
  neutral.

### Cards / Containers

- **Corner Style:** marketing cards may use the larger Pagelea radii; editor
  panels use square shared edges or small control radii.
- **Background:** white and cool neutral layers divide pages, tools, canvas,
  and properties.
- **Shadow Strategy:** only overlays and the document page receive meaningful
  elevation.
- **Border:** one-pixel structural lines.
- **Internal Padding:** 8, 12, 16, or 24 pixels according to density.

### Inputs / Fields

- **Style:** neutral filled fields with a one-pixel border and 10–12-pixel
  radius.
- **Focus:** visible outline plus border shift; never colour alone.
- **Error / Disabled:** semantic tint, text explanation, and reduced contrast
  only when the control is truly unavailable.

### Navigation

Desktop uses persistent page and property regions around a central document
stage. Tablet collapses secondary regions into side drawers. Mobile keeps the
canvas full-height and exposes pages and properties as labelled, dismissible
bottom sheets. Editing tools remain within thumb reach and horizontally
scrollable without hiding any feature.

### PDF Stage

The stage owns all remaining viewport space. Fit-page is the initial zoom on
every device; explicit zoom switches to a user-controlled value. The page is
always reachable without the surrounding marketing page scrolling.

## Do's and Don'ts

### Do:

- **Do** give the PDF the largest continuous viewport available.
- **Do** keep coarse-pointer targets at least 44 by 44 CSS pixels.
- **Do** preserve the same page, tool, property, undo, redo, zoom, and export
  capabilities across desktop, tablet, and mobile.
- **Do** use drawers and bottom sheets for progressive disclosure.
- **Do** respect safe-area insets, reduced motion, keyboard focus, and the
  visual viewport.

### Don't:

- **Don't** ship “a document editor embedded inside a marketing-page card or
  constrained canvas.”
- **Don't** stack desktop panels into a long scrolling page on mobile.
- **Don't** rely on hover-dependent controls, tiny touch targets, or hidden
  core functionality on touch devices.
- **Don't** let decorative product chrome compete with the PDF.
- **Don't** imitate Sejda or another vendor's branding, visual assets, copy, or
  proprietary interaction details.
- **Don't** introduce generic SaaS dashboards, gratuitous glass effects,
  gradient text, side-stripe cards, or motion that delays document work.
