// The globe tab's REELS mode renders the real reels engine (src/features/reels).
// This file used to be a placeholder slot; it now re-exports the implementation so
// GlobeScreen's import and the globe index keep working unchanged.
export { ReelsView, default } from '../reels/ReelsView';
export type ReelsViewProps = {
  active: boolean;
  nation?: string;
  postId?: string;
  overlay?: boolean;
  onClose?: () => void;
};
