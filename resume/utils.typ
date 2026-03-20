// Create a consistent vertical spacing
#let space(h: 0.6em) = v(h, weak: true)

// Shortcut for evaluating a string as markup
#let markup(str) = eval(str, mode: "markup")

// Format a job entry
#let job(
  title: "",
  company: "",
  location: "",
  start: "",
  end: "Present",
  achievements: (),
) = {
  let format = "[month repr:long] [year]"
  let end = if type(end) == str [#end] else [#end.display(format)]

  stack(
    dir: ltr,
    align(alignment.start, [
      === #pad(top: 0pt, bottom: -4pt, title)
      #company
    ]),
    align(alignment.end, [#start.display(format) --- #end \ #emph(location)]),
  )

  space(h: 0.4em)
  list(..achievements.map(markup))
  v(-0.7em)
}

#let to-string(content) = {
  if content.has("text") {
    content.text
  } else if content.has("children") {
    content.children.map(to-string).join("")
  } else if content.has("body") {
    to-string(content.body)
  } else if content == [ ] {
    " "
  }
}

// Format a project entry
#let project(title: "", github: "", tags: (), achievements: ()) = {
  // assert achievements end with a period
  for achievement in achievements {
    assert(
      achievement.trim().ends-with("."),
      message: "achievements must end with a period",
    )
  }

  [
    === #pad(top: 0pt, bottom: -2pt, text([
      #link("https://github.com/" + github, title)
      --
      #tags.join(", ")], weight: "regular"))
  ]

  space(h: 0.7em)
  list(..achievements.map(markup))
  space(h: 0.9em)
}

// Create a section heading
#let section(title: "", right: "") = {
  [
    == #pad(top: -5pt, bottom: -18pt, smallcaps(title))
    #h(1fr)
    #right
  ]

  line(length: 100%)
}

// Create a coloured header with some centered content
#let header(content, padding: 0.3in, alignment: center + horizon) = box(
  width: 100%,
  fill: rgb(38, 38, 38),
  // we want to push the content below it down
  inset: (bottom: padding - 0.1in),
  // but since this is at the top, we want to fill
  // the margin with the background of the box
  outset: (x: padding, top: padding),
  align(alignment, content),
)
