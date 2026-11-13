/** Sample people for the landing and sign-in illustrations. */
export const SAMPLE_NAMES = [
  "Kweku Ohemeng",
  "Kojo Appiah",
  "Esi Quaye",
  "Kobina Baah",
  "Akosua Boateng",
  "Kwabena Asante",
  "Efua Owusu",
  "Yaw Darko",
  "Abena Ofori",
  "Nana Yaw",
  "Adjoa Frimpong",
  "Nana Ama Agyeman",
  "Kofi Ansah",
  "Agya Yaw",
  "Kwame Banfor",
  "Adjoa Wiafe",
];


/** Random order with no repeats: every name appears once before any comes round again. */
export function nameBag() {
  let bag: string[] = [];
  let last = "";
  return () => {
    if (!bag.length) {
      bag = [...SAMPLE_NAMES];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      if (bag.at(-1) === last) [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]]; // no repeat across rounds
    }
    last = bag.pop()!;
    return last;
  };
}
