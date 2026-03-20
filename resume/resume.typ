#import "utils.typ": *

#let config = toml("../portfolio.toml")

// document setup
#set page(paper: "us-letter", margin: (x: 0.26in, top: 0.3in, bottom: 0.15in))
#set document(
  title: config.at("title", default: config.name + "'s Resume"),
  author: config.at("author", default: config.name),
  keywords: "resume, curriculum vitae, cv, software engineer, developer, programmer",
)

// typography setup
#set text(font: "CMU Serif", weight: "regular", size: 10pt, ligatures: false, lang: "en")
#set par(leading: 0.3em)
#set list(indent: 1em, spacing: 0.6em, tight: false)

#show link: underline
#show line: it => [ #space() #it #space() ]

#let name = text(
  size: 35pt,
  font: "jersey 10",
  weight: "bold",
  config.name,
)

#let about = [
  #config.phone • #config.location \
  #link("mailto:" + config.email, config.email) •
  #link("https://" + config.website, config.website) •
  #link("https://github.com/" + config.github, "github.com/" + config.github) •
  #link("https://www.linkedin.com/in/" + config.linkedin, "linkedin.com/in/" + config.linkedin)
]

#header(
  text(fill: white, [
    #name
    #space(h: 1em)
    #about
  ])
)

#space(h: 0.2in)

#section(title: "Education")

*#config.education.degree*, #config.education.school, #config.education.gpa GPA
#h(1fr)
#config.education.start.display("[month repr:long] [year]") --- #config.education.end.display("[month repr:long] [year]")


#section(title: "Experience")

#for entry in config.job {
  if entry.at("enabled", default: true) {
    job(
      title: entry.title,
      company: entry.company,
      location: entry.location,
      start: entry.start,
      end: entry.at("end", default: "Present"),
      achievements: entry.achievements,
    )
  }
}


#section(title: "Achievements")
#list(..config.achievements.items)

#space(h: 1em)

#section(title: "Projects")

#for entry in config.project {
  if entry.at("enabled", default: true) {
    project(
      title: entry.title,
      github: entry.github,
      tags: entry.tags,
      achievements: entry.achievements,
    )
  }
}

#space(h: 1em)

#section(title: "Technical Skills")
#text(
  size: 10pt,
  [
    *Languages*: #config.skills.languages.join(", ")
    #space(h: .8em)
    *Libraries*: #config.skills.libraries.join(", ")
    #space(h: .8em)
    *Tools*: #config.skills.tools.join(", ")
  ],
)
