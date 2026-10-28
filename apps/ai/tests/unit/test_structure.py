"""Headings, sections and rule tags (plan v3 §5, steps 5, 7 and 8): pure functions over page text."""

from uuid import UUID, uuid4

from vidyam_ai.domain.chunking import PageText, chunk_pages, context_header
from vidyam_ai.domain.documents import Heading, TextRun
from vidyam_ai.domain.headings import find_headings, markdown_headings, page_markdown, styled_lines
from vidyam_ai.domain.sections import (
    LabelledPage,
    ManifestSection,
    PlannedSection,
    Structure,
    SyllabusNode,
    find_toc,
    match_node,
    plan_sections,
    section_of,
)
from vidyam_ai.domain.tagging import rule_tags

SCIENCE, PHYSICS, MOTION, FORCE, ACCELERATION = (uuid4() for _ in range(5))
NODES = [
    SyllabusNode(SCIENCE, None, "subject", "science", "Science", "विज्ञान"),
    SyllabusNode(PHYSICS, SCIENCE, "unit", "science/physics", "Physics", "भौतिकी"),
    SyllabusNode(MOTION, PHYSICS, "chapter", "science/physics/motion", "Motion", "गति", ("gati",)),
    SyllabusNode(
        FORCE, PHYSICS, "chapter", "science/physics/force", "Force and Laws of Motion", "बल तथा गति के नियम"
    ),
    SyllabusNode(
        ACCELERATION, MOTION, "topic", "science/physics/motion/acceleration", "Acceleration", "त्वरण"
    ),
]


def page(*lines: tuple[str, float, bool]) -> list[TextRun]:
    runs: list[TextRun] = []
    for text, size, bold in lines:
        runs += [TextRun(text, "F", size, bold), TextRun("\r\n", None)]
    return runs


def test_headings_are_larger_or_bold_lines_and_running_headers_are_not() -> None:
    body = "गति का अर्थ है समय के साथ स्थिति में परिवर्तन होना और यह सापेक्ष होती है।"
    pages = [
        page(
            ("Physics Notes", 9, False),
            ("अध्याय 8: गति", 18, True),
            ("दूरी और विस्थापन", 14, True),
            (body, 11, False),
        ),
        page(
            ("Physics Notes", 9, False), ("चाल और वेग", 14, True), (body, 11, False), ("Key points", 11, True)
        ),
        page(("Physics Notes", 9, False), (body, 11, False), ("3", 9, False)),
    ]
    headings = find_headings([styled_lines(runs) for runs in pages])
    assert headings == [
        (Heading(1, "अध्याय 8: गति"), Heading(2, "दूरी और विस्थापन")),
        (Heading(2, "चाल और वेग"), Heading(3, "Key points")),
        (),
    ]


def test_chapter_lines_are_headings_even_in_plain_text() -> None:
    [headings] = find_headings([styled_lines([TextRun("Chapter 3 Motion\nA body moves when...", None)])])
    assert headings == (Heading(1, "Chapter 3 Motion"),)
    assert markdown_headings("# Motion\n\ntext\n\n## Speed\n#### Deep") == (
        Heading(1, "Motion"),
        Heading(2, "Speed"),
        Heading(3, "Deep"),
    )


def test_headings_become_markdown_and_a_wrapped_heading_one_line() -> None:
    text = "प्रकाश – परावर्तन\nतथा अपवर्तन\nप्रकाश एक ऊर्जा है।"
    headings = [Heading(1, "प्रकाश – परावर्तन"), Heading(1, "तथा अपवर्तन")]
    assert page_markdown(text, headings) == "# प्रकाश – परावर्तन तथा अपवर्तन\nप्रकाश एक ऊर्जा है।"


def test_chunks_follow_headings_and_know_their_kind() -> None:
    pages = [
        PageText(1, "# अध्याय 8: गति\n## दूरी और विस्थापन\nदूरी अदिश राशि है।\n\nविस्थापन सदिश राशि है।"),
        PageText(
            2, "## त्वरण\nवेग में परिवर्तन की दर को त्वरण कहते हैं।\n\n1. त्वरण का मात्रक क्या है?\n(A) m/s\n(B) m/s²"
        ),
    ]
    chunks = chunk_pages(pages)
    assert [(c.heading_path, c.kind, c.page_start) for c in chunks] == [
        (("अध्याय 8: गति", "दूरी और विस्थापन"), "prose", 1),
        (("अध्याय 8: गति", "त्वरण"), "definition", 2),
        (("अध्याय 8: गति", "त्वरण"), "question", 2),
    ]
    assert chunks[0].text == "दूरी अदिश राशि है।\n\nविस्थापन सदिश राशि है।"  # the heading is in the path
    assert context_header("गति — नोट्स", chunks[1].heading_path) == "गति — नोट्स › अध्याय 8: गति › त्वरण"
    assert context_header("Motion", ("Motion", "Speed")) == "Motion › Speed"


def test_titles_match_syllabus_nodes_in_either_language() -> None:
    assert match_node("अध्याय 8: गति", NODES) == (NODES[2], 1.0)
    assert match_node("Chapter 9 - Force and Laws of Motion", NODES) == (NODES[3], 1.0)
    found = match_node("गति के नियम", NODES)
    assert found and found[0] is NODES[3]
    assert match_node("Magnetism", NODES) is None


def test_manifest_sections_win_and_cover_their_pages() -> None:
    pages = [LabelledPage(n, None, "# Some heading\ntext") for n in range(1, 9)]
    structure = Structure(
        sections=(ManifestSection(5, 8, FORCE, None), ManifestSection(1, 4, MOTION, "Gati"))
    )
    sections = plan_sections(pages, structure, NODES, hindi=True)
    assert [(s.title, s.page_start, s.page_end, s.node_id, s.origin) for s in sections] == [
        ("Gati", 1, 4, MOTION, "manifest"),
        ("बल तथा गति के नियम", 5, 8, FORCE, "manifest"),
    ]
    whole = plan_sections(pages, Structure(chapter=MOTION), NODES, hindi=False)
    assert [(s.title, s.page_start, s.page_end, s.confidence) for s in whole] == [("Motion", 1, 8, 1.0)]


def test_a_table_of_contents_maps_printed_pages_to_sections() -> None:
    toc = "# विषय-सूची\n1. गति ......... 41\n2. बल तथा गति के नियम ......... 43\n3. चुंबकत्व ......... 45"
    pages = [LabelledPage(1, "40", toc)] + [LabelledPage(n, str(n + 39), "text") for n in range(2, 8)]
    assert find_toc(pages) == [("1. गति", "41"), ("2. बल तथा गति के नियम", "43"), ("3. चुंबकत्व", "45")]
    sections = plan_sections(pages, Structure(), NODES, hindi=True)
    assert [(s.page_start, s.page_end, s.node_id, s.origin) for s in sections] == [
        (2, 3, MOTION, "toc"),
        (4, 5, FORCE, "toc"),
        (6, 7, None, "toc"),  # no syllabus node: kept for structure, mapped by a person later
    ]


def test_without_a_manifest_or_contents_top_headings_make_the_sections() -> None:
    pages = [
        LabelledPage(1, None, "# अध्याय 8: गति\n## त्वरण\ntext"),
        LabelledPage(2, None, "text"),
        LabelledPage(3, None, "# अध्याय 9: बल तथा गति के नियम\ntext"),
    ]
    sections = plan_sections(pages, Structure(), NODES, hindi=True)
    assert [(s.page_start, s.page_end, s.node_id, s.origin) for s in sections] == [
        (1, 2, MOTION, "heading"),
        (3, 3, FORCE, "heading"),
    ]
    chunks = chunk_pages([PageText(p.page_no, p.text) for p in pages])
    assert [section_of(chunk, sections) for chunk in chunks] == [0, 1]  # pages 1–2 share a heading


def test_rule_tags_trust_the_manifest_then_sections_then_the_subject() -> None:
    def section(node: UUID | None, confidence: float | None, origin: str = "heading") -> PlannedSection:
        return PlannedSection("t", 1, 2, node, origin, confidence)  # type: ignore[arg-type]

    assert [(t.node_id, t.method, t.is_primary) for t in rule_tags(MOTION, section(FORCE, 0.9), SCIENCE)] == [
        (MOTION, "manifest", True)
    ]
    assert [(t.node_id, t.method, t.is_primary) for t in rule_tags(None, section(FORCE, 0.9), SCIENCE)] == [
        (FORCE, "section", True)
    ]
    weak = rule_tags(None, section(FORCE, 0.4), SCIENCE)
    assert [(t.node_id, t.is_primary) for t in weak] == [(FORCE, False), (SCIENCE, True)]
    assert [(t.node_id, t.method) for t in rule_tags(None, None, SCIENCE)] == [(SCIENCE, "manifest")]
    assert rule_tags(None, None, None) == []
