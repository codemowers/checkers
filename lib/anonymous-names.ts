/** Codenames are fixed pairs, never independently chosen words. */
export const ANONYMOUS_NAMES = [
  { name: "Artful Ant", icon: "🐜" },
  { name: "Bionic Beaver", icon: "🦫" },
  { name: "Cosmic Crab", icon: "🦀" },
  { name: "Dapper Duck", icon: "🦆" },
  { name: "Eoan Eagle", icon: "🦅" },
  { name: "Focal Fox", icon: "🦊" },
  { name: "Groovy Gorilla", icon: "🦍" },
  { name: "Hirsute Hippo", icon: "🦛" },
  { name: "Intrepid Ibex", icon: "🐐" },
  { name: "Jammy Jellyfish", icon: "🪼" },
  { name: "Karmic Koala", icon: "🐨" },
  { name: "Lunar Lobster", icon: "🦞" },
  { name: "Maverick Monkey", icon: "🐒" },
  { name: "Noble Newt", icon: "🦎" },
  { name: "Oneiric Owl", icon: "🦉" },
  { name: "Precise Penguin", icon: "🐧" },
  { name: "Quantal Quail", icon: "🐦" },
  { name: "Resolute Raccoon", icon: "🦝" },
  { name: "Saucy Squid", icon: "🦑" },
  { name: "Trusty Turtle", icon: "🐢" },
  { name: "Utopic Unicorn", icon: "🦄" },
  { name: "Vivid Viper", icon: "🐍" },
  { name: "Wily Wolf", icon: "🐺" },
  { name: "Yakkety Yak", icon: "🐂" },
  { name: "Zesty Zebra", icon: "🦓" },
] as const;

export function randomName() {
  return ANONYMOUS_NAMES[crypto.getRandomValues(new Uint32Array(1))[0] % ANONYMOUS_NAMES.length].name;
}

export function anonymousIcon(name: string) {
  const normalized = name.trim().replace(/\s+/g, " ").toLowerCase();
  return ANONYMOUS_NAMES.find(candidate => candidate.name.toLowerCase() === normalized)?.icon ?? "👤";
}
