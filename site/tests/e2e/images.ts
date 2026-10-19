import type { Page } from "@playwright/test";

/**
 * Filenames of the images under `selector` that have not loaded, so a failure
 * names what is missing. Lazy images are switched to eager first, so the whole
 * page is fetched and not just the viewport. A file missing from the bucket
 * finishes "complete" with no width and stays in this list for good, so poll
 * until it is empty.
 */
export function unloadedImages(page: Page, selector = "img") {
  return page.locator(selector).evaluateAll((imgs) =>
    (imgs as HTMLImageElement[])
      .map((img) => {
        img.loading = "eager";
        return img;
      })
      .filter((img) => !img.complete || img.naturalWidth === 0)
      .map((img) => (img.currentSrc || img.src).split("/").pop()),
  );
}
