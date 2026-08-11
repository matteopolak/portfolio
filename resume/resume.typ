#import "utils.typ": *

#let config-path = sys.inputs.at("config", default: "portfolio.toml")
#let config = toml("/" + config-path)

// document setup
#set page(paper: "us-letter", margin: (x: 0.3in, top: 0.28in, bottom: 0.18in))
#set document(
  title: config.at("title", default: config.name + "'s Resume"),
  author: config.at("author", default: config.name),
  keywords: "resume, curriculum vitae, cv, software engineer, developer, programmer",
)

// typography setup
#set text(font: "CMU Serif", weight: "regular", size: 10pt, ligatures: false, lang: "en")
#set par(leading: 0.28em)
#set list(indent: 1em, spacing: 0.5em, tight: false)

#show link: underline
#show line: it => [ #space() #it #space() ]

#let name = text(
  size: 27pt,
  font: "jersey 10",
  weight: "bold",
  config.name,
)

#let about = text(size: 9.4pt, [
  #config.phone • #config.location \
  #link("mailto:" + config.email, config.email) •
  #link("https://" + config.website, config.website) •
  #link("https://github.com/" + config.github, "github.com/" + config.github) •
  #link("https://www.linkedin.com/in/" + config.linkedin, "linkedin.com/in/" + config.linkedin)
])

#header(
  outset: (x: 0.3in, top: 0.28in),
  text(fill: white, [
    #name
    #space(h: 1em)
    #about
  ])
)

#space(h: 0.12in)

#section(title: "Education")

*#config.education.degree*, #config.education.school, #config.education.gpa GPA
#h(1fr)
#config.education.start.display("[month repr:long] [year]") --- #config.education.end.display("[month repr:long] [year]")


#let enabled-jobs = config.at("job", default: ()).filter(e => e.at("enabled", default: true))

#if enabled-jobs.len() > 0 {
  section(title: "Experience")

  for entry in enabled-jobs {
    job(
      title: entry.title,
      company: entry.company,
      location: entry.location,
      start: entry.start,
      end: entry.at("end", default: "Present"),
      achievements: entry.at("achievements", default: ()),
    )
  }
}


#let all-achievements = config.at("achievement", default: (:))

#if all-achievements.len() > 0 {
  section(title: "Achievements")
  list(
    ..all-achievements.values().map(entry => {
      if "text" in entry {
        entry.text
      } else {
        let linked = entry.item.map(i => {
          let label = if "pop" in i { i.name + " (" + str(i.pop) + ")" } else { i.name }
          link(i.url, label)
        })
        let joined = if linked.len() == 1 {
          linked.at(0)
        } else if linked.len() == 2 {
          linked.at(0) + [ and ] + linked.at(1)
        } else {
          linked.slice(0, -1).join(", ") + [, and ] + linked.last()
        }
        entry.prefix + joined
      }
    })
  )

  space(h: 1em)
}


#let enabled-projects = config.at("project", default: ()).filter(e => e.at("enabled", default: true))

#if enabled-projects.len() > 0 {
  section(title: "Projects")

  for entry in enabled-projects {
    project(
      title: entry.title,
      github: entry.github,
      tags: entry.at("tags", default: ()),
      achievements: entry.at("achievements", default: ()),
    )
  }

  space(h: 1em)
}


#let skills = config.at("skills", default: (:))
#let skill-groups = if "group" in skills {
  skills.group.filter(g => g.items.len() > 0)
} else {
  let legacy = (
    ("Languages", skills.at("languages", default: ())),
    ("AI & Agent Systems", skills.at("agents", default: ())),
    ("APIs & Protocols", skills.at("protocols", default: ())),
    ("Platforms & Tooling", skills.at("tools", default: ())),
  )
  legacy.filter(g => g.at(1).len() > 0).map(g => (label: g.at(0), items: g.at(1)))
}

#if skill-groups.len() > 0 {
  section(title: "Technical Skills")
  let skill-rows = skill-groups.map(g => [*#g.label*: #g.items.join(", ")])
  text(size: 10pt, skill-rows.join(space(h: 0.8em)))
}
