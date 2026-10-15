import styles from './workday-widget.module.css';

export type Buddy = 'cat' | 'robot' | 'coffee';

function PixelOfficeCat({ progress }: { progress: number }) {
  return (
    <svg
      className={styles.companion}
      viewBox="0 0 120 144"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <rect
        x="15"
        y="132"
        width="90"
        height="4"
        fill="currentColor"
        opacity="0.06"
      />
      <g className={styles.catTail}>
        <path d="M89 68h12V52h-6V40h6v6h6v28H89Z" fill="#b98049" />
        <rect x="95" y="40" width="6" height="8" fill="#ecc393" />
      </g>
      <path d="M36 52h48v28H36Z" fill="#b98049" />
      <path d="M30 14h12v8h36v-8h12v40h-6v8H36v-8h-6Z" fill="#dca76a" />
      <path d="M34 20h6v12h-6ZM80 20h6v12h-6Z" fill="#dc9d91" />
      <path d="M48 22h6v10h-6ZM60 22h6v10h-6ZM72 22h6v10h-6Z" fill="#bd864e" />
      <path d="M38 47h12v8H38ZM70 47h12v8H70Z" fill="#ebbd85" />
      <path d="M43 42h6v2h-6ZM71 42h6v2h-6Z" fill="#493e36" />
      <g className={styles.catEyes} fill="#493e36">
        <rect x="44" y="36" width="4" height="7" />
        <rect x="72" y="36" width="4" height="7" />
      </g>
      <path d="M57 44h6v4h-6ZM54 50h6v3h-6ZM60 50h6v3h-6Z" fill="#a36d58" />
      <path d="M24 62h72v4h4v50H20V66h4Z" fill="#b1a895" />
      <path d="M24 66h72v46H24Z" fill="#e4dac3" />
      <rect x="30" y="72" width="60" height="31" fill="#354c46" />
      <path d="M32 74h56v2H32Z" fill="#48665a" />
      <g className={styles.screenHeart} fill="#dfab87">
        <path d="M50 79h8v4h4v-4h8v10h-4v4h-4v4h-4v-4h-4v-4h-4Z" />
      </g>
      <rect x="77" y="107" width="6" height="3" fill="#81a889" />
      <rect x="84" y="107" width="4" height="3" fill="#a49b87" />
      <path d="M47 116h26v8h10v5H37v-5h10Z" fill="#b1a895" />
      <rect x="41" y="125" width="38" height="3" fill="#d4c8af" />
      <path d="M35 61h14v8H35ZM71 61h14v8H71Z" fill="#ebbd85" />
      <path d="M40 65v4m4-4v4m32-4v4m4-4v4" stroke="#b98049" strokeWidth="1" />
      {Array.from({ length: 6 }, (_, i) => (
        <rect
          key={i}
          x={33 + i * 9}
          y="99"
          width="6"
          height="2"
          fill={progress >= (i + 1) / 6 ? '#b6d4a6' : '#587265'}
        />
      ))}
    </svg>
  );
}

function PixelRobot({ progress }: { progress: number }) {
  return (
    <svg
      className={styles.companion}
      viewBox="0 0 120 144"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <rect
        x="18"
        y="132"
        width="84"
        height="4"
        fill="currentColor"
        opacity="0.06"
      />
      <path d="M58 18h4v15h-4Z" fill="#73979d" />
      <rect
        className={styles.robotAntenna}
        x="54"
        y="13"
        width="12"
        height="9"
        fill="#e3ae86"
      />
      <path d="M28 31h64v5h5v43h-5v5H28v-5h-5V36h5Z" fill="#7a9da3" />
      <rect x="29" y="37" width="62" height="41" fill="#b2d0ce" />
      <rect x="35" y="43" width="50" height="27" fill="#354c52" />
      <g className={styles.catEyes} fill="#d9e6ba">
        <rect x="43" y="48" width="6" height="8" />
        <rect x="71" y="48" width="6" height="8" />
      </g>
      <path d="M52 59v4h16v-4h-4v2h-8v-2Z" fill="#d9e6ba" />
      <path d="M16 47h7v20h-7ZM97 47h7v20h-7Z" fill="#d7b484" />
      <rect x="51" y="84" width="18" height="5" fill="#5a7e85" />
      <rect x="34" y="89" width="52" height="32" fill="#8eaeb0" />
      <rect x="40" y="95" width="40" height="12" fill="#506e71" />
      {Array.from({ length: 5 }, (_, i) => (
        <rect
          key={i}
          x={43 + i * 7}
          y="98"
          width="5"
          height="6"
          fill={progress >= (i + 1) / 5 ? '#d7d6a4' : '#749294'}
        />
      ))}
      <rect x="43" y="112" width="5" height="4" fill="#e3ae86" />
      <rect x="53" y="112" width="5" height="4" fill="#d7d6a4" />
      <path d="M26 94h8v20h-8ZM86 94h8v20h-8Z" fill="#d7b484" />
      <g className={styles.robotWave}>
        <path d="M92 94h8V82h-4v-8h4v4h4v20H92Z" fill="#8eaeb0" />
      </g>
      <path
        d="M40 121h12v6H36v4h20v-10ZM68 121h12v6h4v4H64v-10Z"
        fill="#5a7e85"
      />
    </svg>
  );
}

function PixelCoffee({ progress }: { progress: number }) {
  return (
    <svg
      className={styles.companion}
      viewBox="0 0 120 144"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <rect
        x="16"
        y="132"
        width="88"
        height="4"
        fill="currentColor"
        opacity="0.06"
      />
      <g className={styles.coffeeSteam} fill="#b9b2a2">
        <path d="M38 24h4v10h-4v8h-4V32h4ZM58 16h4v12h-4v10h-4V26h4ZM78 25h4v10h-4v8h-4V33h4Z" />
      </g>
      <path d="M86 58h17v5h5v28h-5v5H86v-8h11V66H86Z" fill="#b99878" />
      <path d="M25 49h63v53h-5v10H31v-10h-6Z" fill="#d5b692" />
      <path d="M30 54h53v47h-5v6H35v-6h-5Z" fill="#f0dfbf" />
      <rect x="30" y="52" width="53" height="7" fill="#916c50" />
      <rect x="34" y="53" width="45" height="3" fill="#b88d68" />
      <path d="M38 76h10v3H38ZM65 76h10v3H65Z" fill="#755c4b" />
      <g className={styles.catEyes} fill="#755c4b">
        <rect x="42" y="71" width="4" height="7" />
        <rect x="67" y="71" width="4" height="7" />
      </g>
      <path d="M50 84v4h13v-4h-3v2h-7v-2Z" fill="#a0785e" />
      <rect x="34" y="83" width="7" height="3" fill="#ddb0a0" />
      <rect x="72" y="83" width="7" height="3" fill="#ddb0a0" />
      <path d="M19 115h78v5h-6v4H25v-4h-6Z" fill="#b99878" />
      <rect x="25" y="115" width="66" height="4" fill="#ead5b2" />
      {Array.from({ length: 6 }, (_, i) => (
        <rect
          key={i}
          x={35 + i * 8}
          y="126"
          width="5"
          height="3"
          fill={progress >= (i + 1) / 6 ? '#b99878' : '#b9987833'}
        />
      ))}
    </svg>
  );
}

export function PixelWorkdayBuddy({
  buddy,
  progress,
}: {
  buddy: Buddy;
  progress: number;
}) {
  if (buddy === 'robot') return <PixelRobot progress={progress} />;
  if (buddy === 'coffee') return <PixelCoffee progress={progress} />;
  return <PixelOfficeCat progress={progress} />;
}
