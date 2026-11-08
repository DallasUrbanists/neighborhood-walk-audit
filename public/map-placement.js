// Leaflet suppresses clicks after dragging. Wait briefly before placing a pin
// so the clicks that make up a double-click or double-tap zoom do not place it.
export function enableMapPlacement(map, marker, { onSelect, onIntent, canSelect }) {
  const container = map.getContainer();
  let timer;
  let pending;
  let multiTouch = false;
  let disposed = false;

  function cancel() {
    clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  }

  function flush() {
    const latlng = pending;
    cancel();
    if (latlng && !disposed && canSelect()) onSelect(latlng);
  }

  function onClick(event) {
    const original = event.originalEvent || {};
    if (disposed || !canSelect() || multiTouch || original.button > 0 || original.detail > 1 || original.shiftKey) {
      cancel();
      return;
    }
    // Block a pending automatic GPS result as soon as the user clicks.
    onIntent();
    cancel();
    pending = event.latlng;
    timer = setTimeout(flush, 550);
  }

  function onTouchStart(event) {
    if (event.touches.length === 1) multiTouch = false;
    else if (event.touches.length > 1) { multiTouch = true; cancel(); }
  }

  function onTouchCancel() { multiTouch = true; cancel(); }
  function onPointerDown(event) {
    if (event.pointerType && event.pointerType !== 'touch') multiTouch = false;
  }

  map.on('click', onClick);
  map.on('dragstart zoomstart dblclick', cancel);
  marker.on('dragstart', cancel);
  container.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  container.addEventListener('touchcancel', onTouchCancel, { capture: true, passive: true });
  container.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });

  return {
    cancel,
    flush,
    dispose() {
      disposed = true;
      cancel();
      map.off('click', onClick);
      map.off('dragstart zoomstart dblclick', cancel);
      marker.off('dragstart', cancel);
      container.removeEventListener('touchstart', onTouchStart, true);
      container.removeEventListener('touchcancel', onTouchCancel, true);
      container.removeEventListener('pointerdown', onPointerDown, true);
    }
  };
}
