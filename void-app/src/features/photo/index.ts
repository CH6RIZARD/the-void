// Photo viewer feature. registerPhotoViewer() hooks the feed's openPhoto(postId, index)
// (PostMedia image taps, PostCarousel cells, the thread OP image) up to the /photo route.
import { router } from 'expo-router';
import { registerPhotoOpener } from '../feed/navigation';
import { ROUTES } from '../../nav/routes';

let registered = false;
export function registerPhotoViewer(): void {
  if (registered) return;
  registered = true;
  registerPhotoOpener((postId, index) => {
    router.push(ROUTES.photo(postId, index) as any);
  });
}
export { default as PhotoViewer } from './PhotoViewer';
