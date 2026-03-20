export interface Config {
  name: string;
  phone: string;
  location: string;
  email: string;
  website: string;
  github: string;
  linkedin: string;
  education: Education;
  achievements: { items: string[] };
  skills: { languages: string[]; libraries: string[]; tools: string[] };
  job: Job[];
  project: Project[];
}

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  start: Date;
  end?: Date;
  achievements: string[];
  enabled?: boolean;
}

export interface Project {
  github: string;
  title: string;
  tags: string[];
  achievements: string[];
  enabled?: boolean;
}

export interface Education {
  degree: string;
  school: string;
  gpa: string;
  start: Date;
  end: Date;
}
