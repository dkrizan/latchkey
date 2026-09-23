/** Slowly drifting brand-coloured light behind the page content. Purely decorative. */
export function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="bg-brand-from/25 dark:bg-brand-from/20 animate-float-a absolute -top-40 -left-32 size-[34rem] rounded-full blur-3xl" />
      <div className="bg-brand-to/20 dark:bg-brand-to/15 animate-float-b absolute -top-24 right-[-10rem] size-[30rem] rounded-full blur-3xl" />
      <div className="bg-brand-via/10 animate-float-a absolute bottom-[-16rem] left-1/3 size-[36rem] rounded-full blur-3xl [animation-delay:-7s]" />
    </div>
  );
}
