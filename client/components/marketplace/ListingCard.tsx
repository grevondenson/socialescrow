export function ListingCard({ title, price }: { title: string; price: string }) {
  return (
    <article>
      <h3>{title}</h3>
      <p>{price}</p>
    </article>
  );
}
