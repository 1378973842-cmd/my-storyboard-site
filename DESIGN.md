# Design System Specification

## 1. Overview & Creative North Star

### The Creative North Star: "The Cinematic Alchemist"
This design system is not a mere utility; it is a digital stage. It captures the transition from a blank charcoal canvas to the vibrant, illuminated world of high-end animation. By blending the precision of a professional drafting tool with the atmospheric warmth of a Pixar film, the system creates a "Cinematic Alchemist" experience.

We break the "template" look by eschewing rigid boxes in favor of **intentional asymmetry** and **negative space**. Typography is treated as an editorial element—massive, elegant serifs overlap subtle glass surfaces, creating a sense of depth and narrative. The goal is to make the user feel like they are directing a feature film, not filling out a spreadsheet.

---

## 2. Colors

### Palette Strategy
The palette is rooted in deep, atmospheric neutrals (`surface-container-lowest` at `#0e0e0e`) to allow the "Pixar" accents to glow. The secondary electric blue (`secondary` at `#8dcdff`) and warm amber (`primary` at `#ffb866`) represent the dual nature of production: the cool precision of technology and the warm soul of storytelling.

### The "No-Line" Rule
**Explicit Instruction:** You are prohibited from using 1px solid borders to define sections. Sectioning must be achieved through:
- **Tonal Shifts:** Transitioning from `surface` (#131313) to `surface-container-low` (#1c1b1b).
- **Negative Space:** Using the 16 (5.5rem) or 20 (7rem) spacing tokens to create clear mental boundaries without physical lines.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers.
- **Base:** `surface` (#131313)
- **Sections:** `surface-container-low` (#1c1b1b)
- **Interactive Elements/Cards:** `surface-container-high` (#2a2a2a) or `highest` (#353534).
When nesting, an inner container must always be at least one tier higher in brightness than its parent to simulate a natural "lift" toward the light source.

### The "Glass & Gradient" Rule
Standard flat colors lack "soul." 
- **Glassmorphism:** Use semi-transparent variants of `surface-variant` with a `backdrop-blur` of 20px–40px for floating navigation and toolbars.
- **Signature Gradients:** For primary CTAs, use a linear gradient from `primary` (#ffb866) to `on-primary-container` (#b77100) at a 135° angle.

---

## 3. Typography

The typographic voice is high-contrast and editorial, balancing the "Story" (Serif) with the "Tool" (Sans-Serif).

*   **Display & Headlines (Noto Serif):** Used for narrative beats and cinematic headers. These should be set with tighter letter-spacing (-0.02em) and often placed with asymmetrical offsets to the grid.
*   **Titles & Body (Inter):** The "functional" voice. It provides a precise, modern counterpoint to the romanticism of the serif.
*   **Labels (Manrope):** All-caps or high-tracking small caps used for metadata and technical UI, providing a "blueprint" aesthetic.

---

## 4. Elevation & Depth

### The Layering Principle
Depth is achieved through **Tonal Layering**. Instead of a drop shadow, placing a `surface-container-highest` card atop a `surface` background creates a sophisticated, tactile lift.

### Ambient Shadows
When an element must float (e.g., a modal or floating toolbar):
- **Blur:** 40px to 80px.
- **Opacity:** 4% to 8% of the `on-surface` color.
- **Light Source:** Shadows should be offset slightly on the Y-axis to mimic a warm overhead light.

### The "Ghost Border"
If a container requires a boundary for accessibility, use a **0.5px** "Ghost Border." 
- **Token:** `outline-variant` (#45464d) at **20% opacity**.
- **Rule:** Never use 100% opaque borders. The boundary should be "felt" rather than "seen."

---

## 5. Components

### Buttons
*   **Primary:** High-vibrancy gradient (`primary` to `on-primary-container`). Roundedness: `full`. No border.
*   **Secondary (Glass):** Semi-transparent `surface-variant` with a `0.5px` ghost border and `backdrop-blur`.
*   **States:** On hover, the `surface-tint` (#ffb866) should create a subtle outer glow (4px blur, 20% opacity).

### Floating Navigation
The navbar should never be a solid bar. Use a **glassmorphic pill** style.
- **Background:** `surface-container-lowest` at 60% opacity.
- **Blur:** 30px.
- **Border:** 0.5px `outline-variant` at 15% opacity.

### Storyboard Cards
- **Background:** `surface-container-low`.
- **Nesting:** The internal "Character Reference" or "Script" areas should use `surface-container-high`.
- **Dividers:** Strictly forbidden. Use a `1.5` (0.5rem) spacing gap or a slight background shift to separate the "Timeline" from the "Viewport."

### Tooltips & Overlays
- **Style:** Dark mode glass. `surface-container-highest` at 80% opacity.
- **Motion:** Fade and slight Y-axis slide (4px) to mimic a physical lens focus.

---

## 6. Do's and Don'ts

### Do
*   **Do** allow text to overlap image backgrounds or glass containers to create a "layered" cinematic depth.
*   **Do** use asymmetrical layouts. A 3-column feature grid should have varying column widths (e.g., 40% - 20% - 40%) to feel custom.
*   **Do** use the `secondary` (Electric Blue) sparingly for data visualization or "active state" indicators only.

### Don't
*   **Don't** use 1px solid borders or high-contrast dividers; they break the "cinematic immersion."
*   **Don't** use standard "Material Design" shadows. Keep them large, soft, and barely visible.
*   **Don't** crowd the layout. If a section feels busy, double the padding using the `24` (8.5rem) spacing token.
*   **Don't** use pure white (#FFFFFF) for text. Use `on-surface` (#e5e2e1) to maintain the sophisticated dark-room feel.