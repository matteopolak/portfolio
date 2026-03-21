---
title: Implementing Axum's extract-as-argument pattern in 100 lines of code
description: A deep dive into how Axum's extract-as-argument pattern works.
date: 2023-11-22
tags:
  - rust
  - axum
  - serde
published: true
---

Axum is a web framework built on top of Tokio and Tower. It is designed to be
ergonomic and easy to use, while still being fast and scalable. One of the
features that makes Axum so easy to use is its extract-as-argument pattern.

## The pattern at a glance

Before we get started, here's what the pattern looks like in action:

```rust {2-3}
fn handler(
  State(state): State<u8>,
  Json(json): Json<Data>,
) -> Response {
  // ...
}
```

This pattern is extremely powerful by allowing you to extract pieces of data in a type-safe
manner from anything at all, not just requests.

There are two different things going on here: the first is the `State` extractor, which clones the state
passed into the handler, but does not consume the request. On the other hand, the `Json` extractor
consumes the request and deserializes the body into the `Data` struct.

## The request types

Let's start by implementing some basic request & response structs and a simple trait for our non-consuming extractors:

```rust
/// A "part" of a request that can be taken out without consuming the request.
/// Note that this struct is Copy, so it can be taken out multiple times.
#[derive(Clone, Copy)]
struct RequestParts {
  count: u8,
}

/// On the other hand, this struct is not Copy, so the data stored in `expensive` can only be "taken out" once.
#[derive(Clone)]
struct Request {
  parts: RequestParts,
  expensive: Vec<u8>,
}

/// Finally, a simple response struct so we can see what's happening.
struct Response {
  content: String,
}

/// A trait for extractors that do not consume the request.
trait FromRequestParts<S> {
  fn from_request_parts(parts: &mut RequestParts, state: S) -> Self;
}
```

## Non-consuming extractors

Now that we have our structs and trait, let's implement the easiest extractor: `State`.

```rust {6}
/// The state extractor clones the state passed into the handler.
struct State<S>(S);

impl<S> FromRequestParts<S> for State<S> {
  fn from_request_parts(_: &mut RequestParts, state: S) -> Self {
    Self(state)
  }
}
```

We ignore the request entirely — we only care about the state.

## Consuming extractors

Okay, great! Now we need a trait that allows an extractor to consume the incoming request.

```rust
mod private {
  pub struct WithParts;
  pub struct WithRequest;
}

trait FromRequest<S, X = private::WithRequest> {
  fn from_request(req: Request, state: S) -> Self;
}
```

This trait is pretty similar to the previous one, but it takes an owned `Request` instead of a mutable reference to `RequestParts`.
We also have a second generic parameter, `X`, which allows us to implement a blanket trait for all types that implement `FromRequestParts`
without worrying about Rust complaining that someone else could do it downstream.

```rust {1-3}
impl<T, S> FromRequest<S, private::WithParts> for T
where
  T: FromRequestParts<S>,
{
  fn from_request(mut req: Request, state: S) -> Self {
    T::from_request_parts(&mut req.parts, state)
  }
}
```

This blanket implementation is pretty simple: if `T` implements `FromRequestParts`, then we can implement `FromRequest` for it,
since `FromRequestParts` only needs a mutable reference to a part of the owned `Request` that we're given.

With that done, let's implement an extractor that returns the expensive `Vec<u8>` from the request.

```rust
struct Expensive(Vec<u8>);

impl<S> FromRequest<S> for Expensive {
  fn from_request(req: Request, _: S) -> Self {
    Self(req.expensive)
  }
}
```

Nothing too special. Now let's try the `Json` extractor.

```rust {8}
struct Json<T>(T);

impl<S, T> FromRequest<S> for Json<T>
where
 T: serde::de::DeserializeOwned,
{
  fn from_request(req: Request, _: S) -> Self {
    Self(serde_json::from_slice(&req.expensive).expect("expected valid json"))
  }
}
```

We don't really care about errors in this example, so we'll just panic if the input isn't valid JSON
that conforms to the data required by `T`.

This extractor is where it gets interesting. We can now use the `Json` extractor to easily deserialize the request body
into any JSON that we want!

## The Handler trait

We still need to actually complete the handler portion, which looks almost magical when you see it for the first time.
In order to do this, we need another trait: `Handler`.

```rust
trait Handler<T, S> {
  fn call(self, req: Request, state: S) -> Response;
}
```

Again, the trait definition is pretty simple. With just a few blanket implementations of common functions, we can
make this trait extremely powerful for any state `S` and arguments `T`. However, it's going to get a bit ugly.
Ideally, we would implement these using a macro to avoid repetition, but we're only going to implement the first two.

```rust
impl<S, F, M, T1> Handler<(M, T1), S> for F
where
  F: FnOnce(T1) -> Response,
  T1: FromRequest<S, M>,
{
  fn call(self, req: Request, state: S) -> Response {
    let t1 = T1::from_request(req, state);

    self(t1)
  }
}

impl<S, F, M, T1, T2> Handler<(M, T1, T2), S> for F
where
  F: FnOnce(T1, T2) -> Response,
  S: Clone,
  T1: FromRequestParts<S>,
  T2: FromRequest<S, M>,
{
  fn call(self, mut req: Request, state: S) -> Response {
    let t1 = T1::from_request_parts(&mut req.parts, state.clone());
    let t2 = T2::from_request(req, state);

    self(t1, t2)
  }
}
```

Okay, okay, that's a lot of spaghetti. Let's break it down. The [`FnOnce`](https://doc.rust-lang.org/std/ops/trait.FnOnce.html)
trait is implemented for functions that can be called once, and the definition looks like the following (simplified):

```rust
pub trait FnOnce<Args>
where
  Args: Tuple,
{
  type Output;

  fn call_once(self, args: Args) -> Self::Output;
}
```

Most importantly, it takes a tuple of arguments that we can generalize over to accept any number
of arguments to our handler.

For our implementation of one argument, we take a function `F` that takes a single argument
`T1` and returns a `Response`. The argument `T1` must implement `FromRequest<S>` (which
includes anything that implements `FromRequestParts<S>` from our blanket implementation earlier),
and the state `S` must be the same as the state passed into the handler.

If we were to implement this trait for `n` arguments, arguments `T1` through `Tn-1` would
need to implement `FromRequestParts<S>`, and argument `Tn` would need to implement `FromRequest<S, M>`,
since it consumes the request.

The actual body of our implementation does exactly that:

```rust {3,5}
fn call(self, mut req: Request, state: S) -> Response {
  // T1 implements FromRequestParts<S>, so we can lend a mutable reference to the request parts.
  let t1 = T1::from_request_parts(&mut req.parts, state.clone());
  // We can still use the request here since the parts were not consumed.
  let t2 = T2::from_request(req, state);

  // After this point, the request has been consumed, so we can't use it anymore.
  // However, we don't need it anymore!

  // We just need to call the function (since F implements FnOnce) with the arguments
  // we just constructed for it.
  self(t1, t2)
}
```

There's also the option of having a handler with no arguments, which just calls the function:

```rust
impl<S, F> Handler<(), S> for F
where
  F: Fn() -> Response,
{
  fn call(self, _: Request, _: S) -> Response {
    self()
  }
}
```

## Putting it together

Now that that's done, let's implement one more extractor to remove the `count` field from the request parts.

```rust
struct Count(u8);

impl<S> FromRequestParts<S> for Count {
  fn from_request_parts(parts: &mut RequestParts, _: S) -> Self {
    Self(parts.count)
  }
}
```

And a `get` function that wraps any handler into something that can process a request:

```rust
fn get<S, H, T>(handler: H) -> impl Fn(Request, S) -> Response
where
  H: Handler<T, S> + Copy,
{
  move |req, state| handler.call(req, state)
}
```

Note the `Copy` bound — since we return an `Fn` (not `FnOnce`), the handler must be callable multiple times.

Let's make a few routes and test them out:

```rust
let route = get(simple);
assert_eq!(route(request.clone(), state).content, "Hello, world!");

let route = get(with_count_and_state);
assert_eq!(
  route(request.clone(), state).content,
  "state: 42, count: 10"
);

let route = get(with_state_and_expensive);
assert_eq!(
  route(request.clone(), state).content,
  "state: 42, expensive: 37"
);

let route = get(with_json);
assert_eq!(route(request.clone(), state).content, "hihihihihihi");
```

And that's it! We've implemented Axum's extract-as-argument pattern in just 100 lines of code.

You can find the full code in the [extract-as-argument](https://github.com/matteopolak/extract-as-argument) repository on my GitHub.
