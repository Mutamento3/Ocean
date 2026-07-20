function Chair({ className }: { className: string }) {
  return (
    <svg className={className} viewBox="0 0 76 68" fill="none" aria-hidden="true">
      <path d="M70.456 57.0395L72.8102 45.4602C74.0404 39.4091 69.1347 33.7962 62.6157 33.7962H36.6588C31.8221 33.7962 27.6263 30.6391 26.542 26.1838L22.2657 8.61375C21.0322 3.5456 15.8295 0.267358 10.4057 1.14066L9.64011 1.26392C3.85236 2.19581 0.0332497 7.47531 1.21461 12.9112L10.8314 57.1621C11.823 61.725 16.072 65 21.0001 65H60.2615C65.2394 65 69.5166 61.6601 70.456 57.0395Z" fill="currentColor" />
    </svg>
  );
}

export function LivingFurniture() {
  return (
    <div className="living-furniture" aria-hidden="true">
      <Chair className="living-left-chair" />
      <svg className="living-left-octopus" viewBox="0 0 37.0008 24.5184" fill="none">
        <path d="M18.5004 1.5C28.7324 1.5 29.3719 12.6066 27.1869 18.16C25.1403 23.3618 32.9424 25.7958 35.5004 18.16M18.5004 1.5C8.26843 1.5 7.62893 12.6066 9.81389 18.16C11.8606 23.3618 4.0584 25.7958 1.50041 18.16M15.4095 10.7727V12.3182M21.5914 10.7727V12.3182" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <Chair className="living-right-chair" />
      <svg className="living-right-fish" viewBox="0 0 30.105 15.8407" fill="none">
        <path d="M28.6049 11.4868C19.7801 1.04218 9.69456 -2.75587 1.50006 7.68876M28.6049 4.35394C19.7801 14.7986 9.69456 18.5966 1.50006 8.15199" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <circle cx="8.63295" cy="7.20714" fill="currentColor" r="1.5" />
      </svg>
    </div>
  );
}
