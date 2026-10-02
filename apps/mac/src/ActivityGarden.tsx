const growthMilestones = [1, 5, 10, 25, 50, 100];

export function ActivityGarden({ total }: { total: number }) {
  const stage = growthMilestones.filter((milestone) => total >= milestone).length;
  const grownPlants = [0, 1, 2, 3, 5, 5, 5][stage];
  return (
    <section className="activity-garden" aria-label="Your growing garden">
      <div className="activity-garden__strip" role="img" aria-label={total === 0 ? "Five seeds ready to grow" : `${grownPlants} ${grownPlants === 1 ? "plant" : "plants"}${stage === 6 ? " in full bloom" : " growing"}`}>
        {[0, 1, 2, 3, 4].map((index) => <Plant key={index} grown={index < grownPlants} tall={stage >= 4 && index % 2 === 1} flowering={stage === 6} budding={stage === 5} />)}
      </div>
      <div className="activity-garden__caption">
        <span>{total === 0 ? "Ready to grow" : stage === 6 ? "In full bloom" : "Your garden is growing"}</span>
        <span>{total === 0 ? "One finish starts it" : `${total.toLocaleString()} ${total === 1 ? "finish" : "finishes"}`}</span>
      </div>
    </section>
  );
}

function Plant({ grown, tall, flowering, budding }: { grown: boolean; tall: boolean; flowering: boolean; budding: boolean }) {
  return (
    <svg className={`activity-garden__plant${tall ? " activity-garden__plant--tall" : ""}`} viewBox="0 0 90 125" aria-hidden="true">
      {!grown ? <ellipse cx="45" cy="112" rx="3" ry="1.8" fill="var(--saved)" /> : (
        <g stroke="var(--saved)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="var(--ink)">
          <path d={`M45 112Q43 88 45 ${flowering ? 31 : budding ? 39 : tall ? 49 : 70}`} fill="none" />
          <path d="M45 95C29 97 21 88 22 77c13 0 21 7 23 18ZM45 82c15 2 24-8 23-18-13 0-21 5-23 18Z" />
          {(tall || flowering || budding) && <path d="M45 64C30 65 25 56 27 48c11 0 16 5 18 16ZM45 51c12 2 21-5 20-14-12 0-18 5-20 14Z" />}
          {budding && <path d="M45 39c-8-5-7-14 0-19 7 5 8 14 0 19Z" />}
          {flowering && <g transform="translate(45 23)" stroke="var(--signal)">
            <path d="M0-8C7-17 16-7 9-2 20 2 12 13 5 8 3 20-10 16-8 6-20 4-14-10-6-6-9-18 3-18 0-8Z" />
            <circle r="2.5" fill="var(--signal)" />
          </g>}
        </g>
      )}
    </svg>
  );
}
