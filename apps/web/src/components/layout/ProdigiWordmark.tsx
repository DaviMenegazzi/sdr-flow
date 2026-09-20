interface ProdigiWordmarkProps {
  className?: string;
}

export function ProdigiWordmark({ className = '' }: ProdigiWordmarkProps) {
  return (
    <span className={`prodigi-wordmark ${className}`} role="img" aria-label="Prodigi">
      <span className="prodigi-wordmark-pro" aria-hidden="true">pro</span>
      <span className="prodigi-wordmark-parenthesis" aria-hidden="true">(</span>
      <span className="prodigi-wordmark-digi" aria-hidden="true">digi</span>
      <span className="prodigi-wordmark-parenthesis" aria-hidden="true">)</span>
    </span>
  );
}
