/** One scene: a picture for light windows and one for dark, in a single SVG document. */
export type Scene = {
  /** What the scene is asked for by, such as `tokyo`. */
  id: string
  /** What it is called, such as `Tokyo`. */
  name: string
  /** The SVG: the day picture shows unless the window is dark (`prefers-color-scheme`). */
  svg: string
}

/** The scenes in the order they take turns, made by tools/build.py. */
export const SCENES: Scene[]
