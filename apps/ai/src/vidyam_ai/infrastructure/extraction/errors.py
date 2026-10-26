from vidyam_ai.application.ingestion import UnreadableFile


class UnreadableDocument(UnreadableFile):
    """The file can't be opened at all (damaged, encrypted, not really the type it claims)."""


class UnsupportedDocument(UnreadableFile):
    """A file type the pipeline can't read (yet)."""
