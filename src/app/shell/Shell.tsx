// Copyright 2026 Ashwin Mukherjee
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// The frame every page stands in: the apparatus beside the specimen, each route's views in their columns, the strip on a phone.

import { type MouseEvent, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import type { DescentState, ListName, Route, Rulers, SampleFile, SampleId } from "../../contracts/app";
import { BREAKPOINT_PHONE, CHROM_X, SAMPLE_READ_MS } from "../../contracts/constants";
import { replay } from "../../data/replay";
import { loadGenes, loadSample } from "../../data/samples";
import { browserNet } from "../../data/store";
import type { LedgerIsland } from "../../ledger";
import rulers from "../../ledger/rulers.json";
import { createReader, type Reader } from "../../worker/client";
import { createDescent, stepFrom } from "../descent/controller";
import { Ledger } from "../descent/Ledger";
import { Tally } from "../descent/Tally";
import { useDescent } from "../descent/useDescent";
import { Genes } from "../genes/Genes";
import { Landing } from "../landing/Landing";
import { List } from "../list/List";
import { listed } from "../list/order";
import type { AppRouter } from "../router";
import { initial, opened, reduce, roomRoute, sourceOf, type Source } from "../state";
import { sitesOf } from "./sites";
import { SHELL_WORDS } from "./words";
import "./shell.css";

/** Where the data bundle and the samples are served from. */
const BASE = "/data/";
/** The sample the landing offers: of the benchmark genomes, the one with the most evidence to show. */
const SAMPLE: SampleId = "hg003";
const RULERS = rulers as Rulers;
const LANDING: Route = { at: "landing" };
const PHONE = `(max-width: ${BREAKPOINT_PHONE}px)`;

type Later = typeof import("./later");

type Cut = Exclude<DescentState, "landing">;
const readOf = (source: Source, state: Cut): Route => ({
  at: "descent",
  sample: source === "file" ? null : source,
  state,
});

function usePhone(): boolean {
  const [phone, setPhone] = useState(() => matchMedia(PHONE).matches);
  useEffect(() => {
    const mq = matchMedia(PHONE);
    const on = () => setPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

export function Shell({ router }: { router: AppRouter }) {
  const [state, dispatch] = useReducer(reduce, router.current(), initial);
  const { route, under, results, genes } = state;
  const [descent] = useState(() => createDescent());
  const view = useDescent(descent);
  const [ledger, setLedger] = useState<LedgerIsland | null>(null);
  const phone = usePhone();
  // The room and its words arrive after the first paint: the same request for everyone, whatever they do.
  const [later, setLater] = useState<Later | null>(null);
  useEffect(() => {
    void import("./later").then(setLater);
  }, []);

  // What a route's arrival may act on at once, without waiting for a render.
  const reader = useRef<Reader | null>(null);
  const samples = useRef(new Map<SampleId, SampleFile>());
  /** The genome being read now. */
  const reads = useRef<Source | null>(null);
  const fileRead = useRef(false);

  const sampleFile = useCallback(
    async (id: SampleId): Promise<SampleFile | null> => {
      const held = samples.current.get(id);
      if (held) return held;
      try {
        const file = await loadSample(BASE, browserNet(), id);
        samples.current.set(id, file);
        return file;
      } catch (e) {
        // The reference data failed to arrive: the landing says so, and it is nobody's file at fault.
        router.go(LANDING, { replace: true });
        descent.feed({ type: "error", reason: "no-data", detail: String(e) });
        return null;
      }
    },
    [router, descent],
  );

  /** A sample's sex pair, known before its read (its donor's): told to the ledger as the sample is chosen. */
  const [knownSex, setKnownSex] = useState<string | null>(null);
  /** A sample's read plays from its result in a fixed time: the address is its loading page from the first event
   *  to the last. */
  const playSample = useCallback(
    async (id: SampleId) => {
      const file = await sampleFile(id);
      if (!file || reads.current) return;
      reads.current = id;
      // The donor's pair is known now: the ledger's sex row settles as the sample is chosen.
      setKnownSex(file.result.sexPair);
      router.go(readOf(id, "loading"));
      descent.play(replay(file.result, SAMPLE_READ_MS));
    },
    [router, descent, sampleFile],
  );

  /** A route is arrived at: by a step, by back or forward, or by its address. */
  const arrive = useCallback(
    (r: Route) => {
      dispatch({ type: "route", route: r });
      // Back on the landing, no genome is chosen: the sex row stands unknown again.
      if (r.at === "landing") setKnownSex(null);
      const source = sourceOf(r);
      const loading = r.at === "descent" && r.state === "loading";
      // A read is left by leaving its page: it stops, and nothing of it is kept.
      if (reads.current && !(loading && reads.current === source)) {
        if (reads.current === "file") {
          reader.current?.close();
          reader.current = null;
        }
        reads.current = null;
        descent.go("landing");
      }
      if (r.at === "landing") {
        // The landing is a fresh start: a file's result is forgotten here, so Forward can't bring it back (its
        // routes find no result and land here again). Choosing the file again reads it again.
        fileRead.current = false;
        dispatch({ type: "forget", source: "file" });
        // A refusal the read ended on stands on the landing; anything else the descent held is let go.
        if (descent.get().at !== "landing") descent.go("landing");
        return;
      }
      if (!source || reads.current) return;
      if (source !== "file") {
        if (loading) void playSample(source);
        else void sampleFile(source).then((f) => f && dispatch({ type: "result", source, result: f.result }));
        return;
      }
      // A file's routes need the file's result, which a reload or a pasted address does not have.
      if (!fileRead.current) router.go(LANDING, { replace: true });
      else if (loading) router.go(readOf("file", "all"), { replace: true });
    },
    [router, descent, playSample, sampleFile],
  );
  useEffect(() => {
    // Listen first: arriving may rewrite the address (a file's route on a reload goes to the landing),
    // and the shell must hear that rewrite, or it keeps the old view with nothing in it.
    const off = router.on(arrive);
    arrive(router.current());
    return off;
  }, [router, arrive]);
  useEffect(() => () => descent.dispose(), [descent]);

  // The gene set is the same for everyone: fetched once, as the page opens.
  useEffect(() => {
    let gone = false;
    loadGenes(BASE, browserNet()).then(
      (g) => gone || dispatch({ type: "genes", genes: g }),
      (e) => gone || descent.feed({ type: "error", reason: "no-data", detail: String(e) }),
    );
    return () => {
      gone = true;
    };
  }, [descent]);

  const readFile = (file: File, leaveOut: boolean) => {
    const worker = (reader.current ??= createReader());
    reads.current = "file";
    fileRead.current = false;
    dispatch({ type: "forget", source: "file" });
    worker.read(file, leaveOut, (event) => {
      if (reads.current !== "file") return;
      // A file turned away before its read begins never leaves the landing.
      if (event.type === "start") router.go(readOf("file", "loading"));
      descent.feed(event);
    });
  };

  // The read's end: its result is kept and the loading page's entry becomes the first count's; or the landing says why not.
  useLayoutEffect(() => {
    const source = reads.current;
    if (!source) return;
    if (view.result && view.at !== "landing" && view.at !== "loading") {
      reads.current = null;
      if (source === "file") {
        fileRead.current = true;
        // The result is all the page keeps: the worker and its reference data (about 350 MB) are let go.
        // Another file starts a fresh worker, whose data comes from the Cache API without a download.
        reader.current?.close();
        reader.current = null;
      }
      dispatch({ type: "result", source, result: view.result });
      router.go(readOf(source, "all"), { replace: true });
    } else if (view.at === "landing" && !view.beat && view.refusal) {
      reads.current = null;
      if (router.current().at !== "landing") router.go(LANDING, { replace: true });
    }
  }, [view, router]);

  // ── What stands on the page ──

  const at = route.at;
  const sideTrip = at === "genes";
  /** The route whose genome shows: a side trip stands over the one it was opened from. */
  const base = sideTrip ? under : route;
  const source = sourceOf(base);
  const onLoading = route.at === "descent" && route.state === "loading";
  /** The read is under way on this page; or it has just ended, and the address is about to say so. */
  const reading = onLoading && view.at === "loading";
  const landed = onLoading && !reading && view.at !== "landing" ? view.result : null;
  const genome = reading || !source ? null : (landed ?? results[source] ?? null);
  const cut: Cut | null = reading ? "loading" : landed ? "all" : route.at === "descent" ? route.state : null;
  const which: ListName = base.at === "list" || base.at === "room" ? base.which : "yours";
  const rows = useMemo(() => (genome ? listed(genome, which) : []), [genome, which]);
  const room = route.at === "room" && genome ? opened(rows, route) : null;
  const finding = room?.finding ?? null;
  /** The room last open, by its genome: on a phone the list it leads back to keeps that row Bold. */
  const [visited, setVisited] = useState<{ source: string; key: string } | null>(null);
  useEffect(() => {
    if (finding && source) setVisited({ source, key: finding.key });
  }, [finding, source]);
  const bySymbol = useMemo(() => new Map((genes ?? []).map((g) => [g.symbol, g])), [genes]);
  // Stable while the gene set is: a new array would replace the ledger.
  const sites = useMemo(() => sitesOf(genes), [genes]);
  const copy = useMemo(
    () => (finding && genes && later ? later.roomCopy(finding, bySymbol.get(finding.bundle.identity.gene)) : null),
    [finding, genes, bySymbol, later],
  );

  // An address naming a variant the list does not hold lands on the list.
  useEffect(() => {
    if (route.at === "room" && genome && !room)
      router.go({ at: "list", sample: route.sample, which: route.which }, { replace: true });
  }, [route, genome, room, router]);

  // The descent follows the route, as its ledger does below.
  useEffect(() => {
    if (route.at === "descent") descent.go(route.state);
    else if (route.at === "list" || route.at === "room") descent.go("list");
  }, [route, descent]);

  // ── The ledger follows the route ──

  const standing: DescentState | "list" = reading
    ? "loading"
    : !genome
      ? "landing"
      : base.at === "descent"
        ? (cut ?? "all")
        : "list";
  const genesMode = at !== "genes" ? "off" : genome ? "overlay" : "reference";
  const applied = useRef<{ handle: LedgerIsland | null; key: string }>({ handle: null, key: "" });
  useLayoutEffect(() => {
    if (!ledger) return;
    const key = `${standing} ${genesMode}`;
    const fresh = applied.current.handle !== ledger;
    if (!fresh && applied.current.key === key) return;
    applied.current = { handle: ledger, key };
    // A ledger drawn anew is already where the page is: only a step from one state to the next moves.
    const animate = !fresh;
    void ledger.state(standing, { animate });
    if (fresh && standing === "list") ledger.list(which);
    if (genesMode !== "off") void ledger.state("genes", { animate });
    ledger.genes(genesMode);
  }, [ledger, standing, genesMode, which]);
  useLayoutEffect(() => {
    if (ledger && reading) ledger.paint(view.fill);
  }, [ledger, reading, view.fill]);

  // ── The strip, on a phone ──

  /** The landing stands before any genome, the list is what was chosen from it: the landing's words or the
   *  list is the whole screen. */
  const landingStands = at === "landing" || (onLoading && view.at === "landing" && view.beat === "release");
  /** Nothing is chosen to fold onto: the apparatus is the whole screen. The genes page stands as the list does. */
  const whole = landingStands || (at === "list" && !!genome) || at === "genes";
  /** The descent never folds: a band of its own height over the ledger, the steps at its foot. */
  const strip = whole ? "whole" : at === "descent" ? "band" : "closed";
  // The band changes the specimen's height under the ledger: it is drawn to it before the first frame shows.
  useLayoutEffect(() => {
    if (strip === "band") ledger?.refit();
  }, [strip, ledger]);
  /** Unfolding the folded strip over a room is the list itself, the screen tall, as the descent leads to it (and as
   *  closing a room on desktop does): a page, not a second list over the receded room. */
  const unfold = () => toList(which);
  /** A tap anywhere on the folded strip unfolds it, save on its own controls. */
  const onBand = (e: MouseEvent<HTMLElement>) => {
    if (phone && strip === "closed" && e.target instanceof Element && !e.target.closest("button, a, input")) unfold();
  };

  // ── Steps ──

  const sample = source && source !== "file" ? source : null;
  const toList = (w: ListName) => router.go({ at: "list", sample, which: w });
  const toRoom = (key: string) => {
    const to = source && roomRoute(source, which, rows, key);
    if (to) router.go(to);
  };
  const open = (key: string) => {
    if (key !== finding?.key) return toRoom(key);
    // The open row again: on a phone it is the folded strip, and leads to the list; beside a room it closes the room.
    if (phone) unfold();
    else toList(which);
  };
  const step = (by: 1 | -1) => () => {
    if (!source || !genome || !cut) return;
    const to = stepFrom(cut, by, genome);
    if (to === "list") toList("yours");
    else if (to && to !== "landing" && to !== "loading") router.go(readOf(source, to));
  };

  // Esc closes the side trips the shell holds; the genes page hears its own.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || route.at !== "room") return;
      router.go({ at: "list", sample: route.sample, which: route.which });
      // Back on the list, focus returns to the row the room was opened from.
      const row = finding && `.list-row[data-key="${CSS.escape(finding.key)}"]`;
      if (row) requestAnimationFrame(() => document.querySelector<HTMLElement>(row)?.focus());
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [route, router, finding]);

  // The landing is a page of its own. It stays up while it lets go, as a read begins.
  let apparatus: JSX.Element | null = null;
  if (landingStands)
    apparatus = (
      <Landing
        genes={genes ?? []}
        refusal={view.refusal}
        onSample={() => void playSample(SAMPLE)}
        onLoadChosen={() => (reader.current ??= createReader()).start()}
        onLoadDropped={() => {
          // Only a download nothing is read with yet: a file being read keeps its worker.
          if (reads.current) return;
          reader.current?.close();
          reader.current = null;
        }}
        onFile={readFile}
        onGenes={() => router.go({ at: "genes" })}
        onGenesPreview={(on) => ledger?.genes(on ? "overlay" : "off")}
      />
    );
  else if (at === "genes")
    apparatus = (
      <Genes
        genes={genes ?? []}
        leftOut={genome?.checked.leftOut ?? 0}
        from={genome ? "results" : "landing"}
        onHover={(g) => phone || ledger?.light(g ? [g] : null)}
        onBack={() => router.back(under)}
      />
    );
  else if (cut && (reading || genome))
    apparatus = (
      <Tally
        result={genome}
        state={cut}
        counting={view.counting}
        reference={view.reference}
        onGenes={() => router.go({ at: "genes" })}
        onGenesPreview={(on) => ledger?.genes(on ? "overlay" : "off")}
        onNext={step(1)}
        onBack={step(-1)}
      />
    );
  else if ((at === "list" || at === "room") && genome)
    apparatus = (
      <List
        key={source}
        result={genome}
        which={which}
        current={finding?.key ?? null}
        marked={phone && visited?.source === source ? visited.key : null}
        ledger={ledger}
        onOpen={open}
        onWhich={toList}
      />
    );

  const next = room ? (rows[room.index + 1]?.key ?? null) : null;
  /** On a phone, the 23rd row stands only where the file has X records: unlabelled, an empty outline reads as a
   *  fault, and with no X there are no marks on it to lose. During the read it waits until
   *  the read reaches X; its place is kept throughout, so nothing moves. */
  const xRead = genome ? (genome.parsed[CHROM_X] ?? 0) > 0 : reading ? (view.fill.f[CHROM_X] ?? 0) > 0 : true;
  const noSexRow = phone && !xRead;
  // On the landing the ledger stands empty, the genome it waits for; the read fills the same drawing.
  const showsLedger = landingStands || reading || at === "genes" || (!!genome && (at === "descent" || at === "list"));
  return (
    <div
      className="frame shell"
      data-at={at}
      data-strip={phone ? strip : undefined}
      data-sex-row={noSexRow ? "none" : undefined}
    >
      <div className="frame-apparatus" onClick={onBand}>
        <button
          type="button"
          className="strip-chev"
          aria-label={SHELL_WORDS.unfold}
          onClick={(e) => {
            e.stopPropagation();
            unfold();
          }}
        >
          <svg width="10" height="5" viewBox="0 0 10 5" aria-hidden="true">
            <polyline points="0.5,0.5 5,4.5 9.5,0.5" />
          </svg>
        </button>
        {apparatus}
      </div>
      <div className="frame-specimen">
        {showsLedger && (
          <Ledger
            result={genome}
            rulers={RULERS}
            genes={sites}
            name={reading ? view.name : (genome?.displayName ?? null)}
            sex={landingStands || reading ? (knownSex ?? view.sex) : null}
            reference={at === "genes" && !genome}
            onHandle={setLedger}
          />
        )}
        {at === "genes" && genome && genome.checked.leftOut > 0 && (
          <p className="note left-out">{SHELL_WORDS.leftOut(genome.checked.leftOut)}</p>
        )}
        {room && copy && later && (
          <later.Room
            finding={room.finding}
            copy={copy}
            list={which}
            next={next}
            onNext={() => next && toRoom(next)}
            onClose={() => toList(which)}
          />
        )}
      </div>
    </div>
  );
}
