/** Renders nothing when no interception is active. Required by parallel
 *  routes — without it a hard navigation 404s the slot. */
export default function ModalDefault() {
  return null;
}
