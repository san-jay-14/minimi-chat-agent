const NEAR_BOTTOM = 40; // px from the end that still counts as "at the end"

// Follows new content while the user is at the end. Once they scroll up it stops,
// and a "jump to latest" button appears until they are back at the end.
export function createScroller(box, jump) {
  let following = true;
  const gap = () => box.scrollHeight - box.scrollTop - box.clientHeight;
  const showJump = () => (jump.hidden = gap() < NEAR_BOTTOM);
  const toEnd = () => {
    box.scrollTop = box.scrollHeight;
    showJump();
  };

  box.addEventListener("scroll", () => {
    following = gap() < NEAR_BOTTOM;
    showJump();
  });
  jump.addEventListener("click", () => {
    following = true;
    toEnd();
  });

  return {
    // Call after any change to the content, once it is in the page: reading
    // scrollHeight forces layout, so late additions (the sources list) are included.
    follow() {
      if (following) toEnd();
      else showJump();
    },
    // A new question always brings the user to the end.
    resume() {
      following = true;
      toEnd();
    },
  };
}
