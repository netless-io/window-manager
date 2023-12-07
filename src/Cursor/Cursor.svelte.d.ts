import { SvelteComponentTyped } from 'svelte/internal'
import { Cursor } from './Cursor'

export interface CursorProps {
  x: number;
  y: number;
  cursorName: string;
  tagName?: string;
  backgroundColor: string;
  appliance: string;
  src?: string;
  visible: boolean;
  avatar: string;
  theme: string;
  color: string;
  cursorTagBackgroundColor: string;
  opacity: number;
  pencilEraserSize?: number;
}

declare class Cursor extends SvelteComponentTyped<CursorProps> {}
export default Cursor;
