export function Button(props) {
  return <button className="lib-button" {...props} />;
}

export function Card({ title }) {
  return (
    <div className="lib-card">
      <h2>{title}</h2>
    </div>
  );
}
