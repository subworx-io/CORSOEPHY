-- Corso — Seed v2: leichte, filmbare Prompts mit Kategorie (Hebel).
-- Bezug: 0011_prompts_categories.sql, docs/PRD.md §4.2.
--
-- Ersetzt die alten introspektiven Prompts inhaltlich:
--   1. Alte (kategorielose) Prompts deaktivieren — kein DELETE, damit Historie/
--      Audit heil bleibt. Sie sind danach nie mehr ziehbar (Auswahl filtert
--      active=true AND category IS NOT NULL).
--   2. 40 neue Prompts einspielen, idempotent per Text, mit Kategorie.
--      14 zeig / 16 augenzwinkern / 10 funken.
--
-- Zwei Texte kamen in der Vorlage verstümmelt an und wurden rekonstruiert:
--   „-, was du siehst, wenn du kurz aufschaust."  -> „Zeig, was du siehst, …"
--   „Zeig den Gegenstanhe mit der peinlichsten…"  -> „Zeig den Gegenstand mit…"

-- ---------------------------------------------------------------------------
-- 1. Alte introspektive Prompts aus der Rotation nehmen
-- ---------------------------------------------------------------------------
update prompts set active = false where category is null;

-- ---------------------------------------------------------------------------
-- 2. Neue Prompts einspielen (idempotent per text; active=true per Default).
--    Re-Run sicher: bereits vorhandene Texte werden übersprungen. Falls ein Text
--    schon existierte (z.B. Alt-Prompt gleichen Wortlauts), Kategorie & Aktiv
--    nachziehen.
-- ---------------------------------------------------------------------------
insert into prompts (text, category, active)
select t, c::prompt_category, true
from (values
  -- zeig (14)
  ('Zeig, wo du gerade sitzt.',                                        'zeig'),
  ('Was steht gerade vor dir?',                                        'zeig'),
  ('Der beste Blick, den du in den letzten 10 Minuten hattest.',       'zeig'),
  ('Zeig, was du gerade in der Hand hast.',                            'zeig'),
  ('Dein Fenster, genau jetzt.',                                       'zeig'),
  ('Was läuft gerade bei dir im Hintergrund?',                         'zeig'),
  ('Zeig den Weg, den du heute am häufigsten gegangen bist.',          'zeig'),
  ('Zeig, was du siehst, wenn du kurz aufschaust.',                    'zeig'),
  ('Zeig deinen Lieblingsplatz in deiner Wohnung.',                    'zeig'),
  ('Was hast du dir heute zu essen gemacht?',                          'zeig'),
  ('Zeig die Straße vor deiner Tür, genau jetzt.',                     'zeig'),
  ('Dein Getränk in diesem Moment.',                                   'zeig'),
  ('Zeig, woran du gerade arbeitest (Bildschirm, Werkbank, egal).',    'zeig'),
  ('Der Ort, an dem du heute am längsten warst.',                      'zeig'),

  -- augenzwinkern (16)
  ('Beweise, dass du gerade nichts Produktives tust.',                                        'augenzwinkern'),
  ('Zeig dein ungesündestes Essen der Woche — ohne Scham.',                                    'augenzwinkern'),
  ('Dein dümmster Kauf der letzten Zeit.',                                                     'augenzwinkern'),
  ('Zeig das Chaos, das du sonst niemandem zeigst.',                                           'augenzwinkern'),
  ('Deine peinlichste offene App oder dein letzter Suchverlauf-Klassiker (nur wenn du dich traust).', 'augenzwinkern'),
  ('Zeig, wie du wirklich sitzt, wenn niemand zuschaut.',                                      'augenzwinkern'),
  ('Das Unnötigste, das gerade in deiner Nähe rumliegt.',                                      'augenzwinkern'),
  ('Beweise mit einem Move, dass du guter Laune bist.',                                        'augenzwinkern'),
  ('Zeig deinen aktuellen Lieblingssong — sing oder wackel mit.',                              'augenzwinkern'),
  ('Was tust du gerade, das deine Mutter nicht gutheißen würde?',                              'augenzwinkern'),
  ('Dein letzter Impulskauf, den du bereust (oder auch nicht).',                               'augenzwinkern'),
  ('Zeig den Gegenstand mit der peinlichsten Geschichte.',                                     'augenzwinkern'),
  ('Mach das Albernste, was dir in den nächsten 5 Sekunden einfällt.',                         'augenzwinkern'),
  ('Zeig deinen Snack-Vorrat ehrlich.',                                                        'augenzwinkern'),
  ('Beweise, dass gerade schlechtes Wetter ist — oder gutes, je nachdem.',                     'augenzwinkern'),
  ('Dein Gesichtsausdruck, wenn der Wecker morgens klingelt (nachstellen).',                   'augenzwinkern'),

  -- funken (10)
  ('Zeig etwas, das die meisten Leute an dir nicht erwarten würden.',  'funken'),
  ('Dein Guilty Pleasure, zu dem du stehst.',                          'funken'),
  ('Woran erkennt man sofort, dass es deine Wohnung ist?',             'funken'),
  ('Zeig, was heute gut gelaufen ist — kurz, ohne Drama.',             'funken'),
  ('Dein Lieblingsort in Düsseldorf, in einem Schwenk.',               'funken'),
  ('Zeig etwas, das dich heute zum Lächeln gebracht hat.',             'funken'),
  ('Die Kleinigkeit, auf die du heimlich stolz bist.',                 'funken'),
  ('Zeig, was du gerade hörst, liest oder schaust.',                   'funken'),
  ('Dein perfekter Feierabend, angefangen genau jetzt.',              'funken'),
  ('Zeig einen Ort in deiner Nähe, den du empfehlen würdest.',         'funken')
) as v(t, c)
where not exists (select 1 from prompts p where p.text = v.t);

-- Nachziehen, falls ein Text schon existierte (Kategorie/aktiv sicherstellen).
update prompts p set category = v.c::prompt_category, active = true
from (values
  ('Zeig, wo du gerade sitzt.', 'zeig'),
  ('Was steht gerade vor dir?', 'zeig'),
  ('Der beste Blick, den du in den letzten 10 Minuten hattest.', 'zeig'),
  ('Zeig, was du gerade in der Hand hast.', 'zeig'),
  ('Dein Fenster, genau jetzt.', 'zeig'),
  ('Was läuft gerade bei dir im Hintergrund?', 'zeig'),
  ('Zeig den Weg, den du heute am häufigsten gegangen bist.', 'zeig'),
  ('Zeig, was du siehst, wenn du kurz aufschaust.', 'zeig'),
  ('Zeig deinen Lieblingsplatz in deiner Wohnung.', 'zeig'),
  ('Was hast du dir heute zu essen gemacht?', 'zeig'),
  ('Zeig die Straße vor deiner Tür, genau jetzt.', 'zeig'),
  ('Dein Getränk in diesem Moment.', 'zeig'),
  ('Zeig, woran du gerade arbeitest (Bildschirm, Werkbank, egal).', 'zeig'),
  ('Der Ort, an dem du heute am längsten warst.', 'zeig'),
  ('Beweise, dass du gerade nichts Produktives tust.', 'augenzwinkern'),
  ('Zeig dein ungesündestes Essen der Woche — ohne Scham.', 'augenzwinkern'),
  ('Dein dümmster Kauf der letzten Zeit.', 'augenzwinkern'),
  ('Zeig das Chaos, das du sonst niemandem zeigst.', 'augenzwinkern'),
  ('Deine peinlichste offene App oder dein letzter Suchverlauf-Klassiker (nur wenn du dich traust).', 'augenzwinkern'),
  ('Zeig, wie du wirklich sitzt, wenn niemand zuschaut.', 'augenzwinkern'),
  ('Das Unnötigste, das gerade in deiner Nähe rumliegt.', 'augenzwinkern'),
  ('Beweise mit einem Move, dass du guter Laune bist.', 'augenzwinkern'),
  ('Zeig deinen aktuellen Lieblingssong — sing oder wackel mit.', 'augenzwinkern'),
  ('Was tust du gerade, das deine Mutter nicht gutheißen würde?', 'augenzwinkern'),
  ('Dein letzter Impulskauf, den du bereust (oder auch nicht).', 'augenzwinkern'),
  ('Zeig den Gegenstand mit der peinlichsten Geschichte.', 'augenzwinkern'),
  ('Mach das Albernste, was dir in den nächsten 5 Sekunden einfällt.', 'augenzwinkern'),
  ('Zeig deinen Snack-Vorrat ehrlich.', 'augenzwinkern'),
  ('Beweise, dass gerade schlechtes Wetter ist — oder gutes, je nachdem.', 'augenzwinkern'),
  ('Dein Gesichtsausdruck, wenn der Wecker morgens klingelt (nachstellen).', 'augenzwinkern'),
  ('Zeig etwas, das die meisten Leute an dir nicht erwarten würden.', 'funken'),
  ('Dein Guilty Pleasure, zu dem du stehst.', 'funken'),
  ('Woran erkennt man sofort, dass es deine Wohnung ist?', 'funken'),
  ('Zeig, was heute gut gelaufen ist — kurz, ohne Drama.', 'funken'),
  ('Dein Lieblingsort in Düsseldorf, in einem Schwenk.', 'funken'),
  ('Zeig etwas, das dich heute zum Lächeln gebracht hat.', 'funken'),
  ('Die Kleinigkeit, auf die du heimlich stolz bist.', 'funken'),
  ('Zeig, was du gerade hörst, liest oder schaust.', 'funken'),
  ('Dein perfekter Feierabend, angefangen genau jetzt.', 'funken'),
  ('Zeig einen Ort in deiner Nähe, den du empfehlen würdest.', 'funken')
) as v(t, c)
where p.text = v.t;
