import type { HTMLAttributes } from "react";
import { FORK_BRAND } from "./brand";
import darkWordmarkUrl from "./assets/tiller-wordmark.svg";
import lightWordmarkUrl from "./assets/tiller-wordmark-light.svg";

export function BrandLogo(props: HTMLAttributes<HTMLPictureElement>) {
  return (
    <picture {...props} data-tiller-wordmark="" role="img" aria-label={FORK_BRAND.logo.label}>
      <img className="hidden size-full dark:block" src={darkWordmarkUrl} alt="" />
      <img className="size-full dark:hidden" src={lightWordmarkUrl} alt="" />
    </picture>
  );
}
