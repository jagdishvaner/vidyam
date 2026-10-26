from vidyam_ai.domain.chunking import MAX_TOKENS, PageText, chunk_pages, detect_language, estimate_tokens


def test_a_question_stays_together_with_its_options() -> None:
    paper = "\n".join(
        [
            "1. भारत का संविधान कब लागू हुआ?",
            "(A) 1947",
            "(B) 1950",
            "(C) 1952",
            "(D) 1949",
            "2. Which article abolishes untouchability?",
            "(a) 14",
            "(b) 17",
        ]
    )
    chunks = chunk_pages([PageText(4, paper)])
    assert len(chunks) == 1
    text = chunks[0].text
    assert text.index("1. भारत") < text.index("(D) 1949") < text.index("2. Which") < text.index("(b) 17")
    assert "(D) 1949\n\n2. Which" in text  # each question is its own block


def test_chunks_record_the_pages_they_span_and_stay_under_the_limit() -> None:
    paragraph = "संविधान सभा ने लंबी बहस के बाद संविधान को अपनाया। " * 40
    pages = [PageText(number, paragraph) for number in range(1, 6)]
    chunks = chunk_pages(pages)
    assert len(chunks) > 1
    assert all(c.token_count <= MAX_TOKENS for c in chunks)
    assert chunks[0].page_start == 1
    assert chunks[-1].page_end == 5
    assert all(c.page_start is not None and c.page_end is not None for c in chunks)
    assert all(c.page_start <= c.page_end for c in chunks if c.page_start and c.page_end)


def test_one_long_paragraph_is_split_at_sentence_ends() -> None:
    sentence = "The Preamble declares India a sovereign, socialist, secular and democratic republic. "
    chunks = chunk_pages([PageText(None, sentence * 120)])
    assert len(chunks) > 1
    assert all(c.token_count <= MAX_TOKENS for c in chunks)
    assert all(c.text.rstrip().endswith(".") for c in chunks)
    assert all(c.page_start is None for c in chunks)  # Word and text files have no page numbers


def test_language_and_token_estimates() -> None:
    assert detect_language("भारत का संविधान") == "hi"
    assert detect_language("Constitution of India") == "en"
    assert detect_language("Article 21 कहता है कि जीवन का अधिकार fundamental right है") == "mixed"
    assert estimate_tokens("भारत") < estimate_tokens("भारत का संविधान")
