export interface HackathonWin {
  id: string;
  date: `${number}-${number}-${number}`;
  project: string;
  hackathon: string;
  awards: string[];
  description: string;
  repositoryUrl: `https://github.com/${string}`;
  submissionUrl: `https://${string}`;
}

/**
 * Hackathon results are kept separate from the main project collection because
 * they are team projects and their dates represent the event, not a release.
 */
export const hackathonWins: HackathonWin[] = [
  {
    id: 'guard-uottahack-8',
    date: '2026-01-18',
    project: 'Guard',
    hackathon: 'uOttaHack 8',
    awards: ['Vercel challenge winner'],
    description:
      'An edge load balancer that combines policy-based routing, live observability, and machine-learning bot detection.',
    repositoryUrl: 'https://github.com/teamy2/guard',
    submissionUrl: 'https://devpost.com/software/guard-z42uyb',
  },
  {
    id: 'uottatype-uottahack-7',
    date: '2025-01-19',
    project: 'uOttaType',
    hackathon: 'uOttaHack 7',
    awards: ['Solace challenge winner'],
    description:
      'A real-time collaborative document editor built around event-driven synchronization, transcription, and AI chat.',
    repositoryUrl: 'https://github.com/95ers/uottatype',
    submissionUrl: 'https://dorahacks.io/buidl/21638',
  },
  {
    id: 'mound-hack-the-hill-2',
    date: '2024-09-29',
    project: 'Mound',
    hackathon: 'Hack the Hill II',
    awards: ['Ciena challenge winner'],
    description:
      'A decentralized file-sharing network with chunk replication, checksums, compression, and peer failover.',
    repositoryUrl: 'https://github.com/mound-p2p/mound',
    submissionUrl: 'https://devpost.com/software/mound',
  },
  {
    id: 'wonderbyte-alicehacks',
    date: '2023-11-19',
    project: 'Wonderbyte',
    hackathon: 'AliceHacks',
    awards: ['3rd place overall', 'Wolfram Alpha award'],
    description:
      'An image-to-recipe application that uses GPT-4 Vision to identify dishes and ingredients, then generate practical recipes.',
    repositoryUrl: 'https://github.com/teamy2/wonderbyte',
    submissionUrl: 'https://devpost.com/software/wonderbyte',
  },
  {
    id: 'moonqwake-space-apps',
    date: '2023-10-08',
    project: 'MoonQwake',
    hackathon: 'NASA Space Apps Challenge — Ottawa',
    awards: ['1st place locally'],
    description:
      'An interactive 3D lunar globe that plots moonquake data and lets viewers scrub through seismic events over time.',
    repositoryUrl: 'https://github.com/y2space/moonqwake',
    submissionUrl:
      'https://www.spaceappschallenge.org/2023/find-a-team/spacemoonkeys/',
  },
  {
    id: 'localeyes-maphacks-2',
    date: '2023-04-01',
    project: 'LocalEyes',
    hackathon: 'MapHacks 2',
    awards: ['1st place overall', 'Best Sustainable Travel Hack'],
    description:
      'A location-aware discovery app with live proximity, accessibility filters, and AI-generated quizzes about nearby places.',
    repositoryUrl: 'https://github.com/localeyes/frontend',
    submissionUrl: 'https://devpost.com/software/tbd-p9xqhv',
  },
  {
    id: 'datadefender-all-in',
    date: '2023-03-26',
    project: 'DataDefender',
    hackathon: 'All In Hackathon',
    awards: ['1st place overall'],
    description:
      'A browser extension that evaluates a site’s security and privacy posture, then explains its risks and safer alternatives.',
    repositoryUrl: 'https://github.com/WilliamUW/MLH-All-In',
    submissionUrl: 'https://devpost.com/software/cyberguardian-hbeouf',
  },
  {
    id: 'hackthefeed-hack-the-hill',
    date: '2023-03-05',
    project: 'HackTheFeed',
    hackathon: 'Hack the Hill',
    awards: [
      'Ciena challenge winner',
      'Best Developer Experience',
      'Best Cybersecurity Project',
    ],
    description:
      'A live cybersecurity RSS aggregator with personalized subscriptions and client-encrypted notes attached to articles.',
    repositoryUrl: 'https://github.com/hackthefeed/frontend',
    submissionUrl: 'https://devpost.com/software/hackthefeed',
  },
];
