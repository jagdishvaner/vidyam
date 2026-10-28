"""Generated from the migrated database by `pnpm --filter @vidyam/ai codegen:db`. Do not edit."""

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    ForeignKeyConstraint,
    Identity,
    Index,
    Integer,
    MetaData,
    Numeric,
    PrimaryKeyConstraint,
    REAL,
    SmallInteger,
    Table,
    Text,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

metadata = MetaData()


t_embedding_versions = Table(
    "embedding_versions",
    metadata,
    Column("id", Text, primary_key=True),
    Column("provider", Text, nullable=False),
    Column("model", Text, nullable=False),
    Column("dims", Integer, nullable=False),
    Column("is_active", Boolean, nullable=False, server_default=text("false")),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    PrimaryKeyConstraint("id", name="embedding_versions_pkey"),
    schema="public",
)

t_llm_models = Table(
    "llm_models",
    metadata,
    Column("id", Text, primary_key=True),
    Column("provider", Text, nullable=False),
    Column("api_model", Text, nullable=False),
    Column("display_name", Text, nullable=False),
    Column("prices", JSONB, nullable=False),
    Column("context_window", Integer, nullable=False),
    Column("max_output_tokens", Integer, nullable=False),
    Column("capabilities", JSONB, nullable=False, server_default=text("'{}'::jsonb")),
    Column("enabled", Boolean, nullable=False, server_default=text("true")),
    Column("teacher_selectable", Boolean, nullable=False, server_default=text("false")),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("updated_at", DateTime(True), nullable=False, server_default=text("now()")),
    PrimaryKeyConstraint("id", name="llm_models_pkey"),
    schema="public",
)

t_organizations = Table(
    "organizations",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("name", Text, nullable=False),
    Column("slug", Text, nullable=False),
    Column("logo", Text),
    Column("created_at", DateTime, nullable=False),
    Column("metadata", Text),
    PrimaryKeyConstraint("id", name="organizations_pkey"),
    UniqueConstraint("slug", name="organizations_slug_unique"),
    schema="public",
)

t_users = Table(
    "users",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("name", Text, nullable=False),
    Column("email", Text, nullable=False),
    Column("email_verified", Boolean, nullable=False, server_default=text("false")),
    Column("image", Text),
    Column("created_at", DateTime, nullable=False, server_default=text("now()")),
    Column("updated_at", DateTime, nullable=False, server_default=text("now()")),
    Column("role", Text),
    Column("banned", Boolean, server_default=text("false")),
    Column("ban_reason", Text),
    Column("ban_expires", DateTime),
    PrimaryKeyConstraint("id", name="users_pkey"),
    UniqueConstraint("email", name="users_email_unique"),
    schema="public",
)

t_verifications = Table(
    "verifications",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("identifier", Text, nullable=False),
    Column("value", Text, nullable=False),
    Column("expires_at", DateTime, nullable=False),
    Column("created_at", DateTime, nullable=False, server_default=text("now()")),
    Column("updated_at", DateTime, nullable=False, server_default=text("now()")),
    PrimaryKeyConstraint("id", name="verifications_pkey"),
    Index("verifications_identifier_idx", "identifier"),
    schema="public",
)

t_accounts = Table(
    "accounts",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("account_id", Text, nullable=False),
    Column("provider_id", Text, nullable=False),
    Column("user_id", Uuid, nullable=False),
    Column("access_token", Text),
    Column("refresh_token", Text),
    Column("id_token", Text),
    Column("access_token_expires_at", DateTime),
    Column("refresh_token_expires_at", DateTime),
    Column("scope", Text),
    Column("password", Text),
    Column("created_at", DateTime, nullable=False, server_default=text("now()")),
    Column("updated_at", DateTime, nullable=False),
    ForeignKeyConstraint(
        ["user_id"], ["public.users.id"], ondelete="CASCADE", name="accounts_user_id_users_id_fk"
    ),
    PrimaryKeyConstraint("id", name="accounts_pkey"),
    Index("accounts_userId_idx", "user_id"),
    schema="public",
)

t_audit_log = Table(
    "audit_log",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("org_id", Uuid, nullable=False),
    Column("user_id", Uuid),
    Column("action", Text, nullable=False),
    Column("entity_type", Text, nullable=False),
    Column("entity_id", Text, nullable=False),
    Column("data", JSONB, nullable=False, server_default=text("'{}'::jsonb")),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="audit_log_org_id_organizations_id_fk",
    ),
    ForeignKeyConstraint(
        ["user_id"], ["public.users.id"], ondelete="SET NULL", name="audit_log_user_id_users_id_fk"
    ),
    PrimaryKeyConstraint("id", name="audit_log_pkey"),
    Index("audit_log_org_id_created_at_index", "org_id", "created_at"),
    schema="public",
)

t_content_templates = Table(
    "content_templates",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("org_id", Uuid, nullable=False),
    Column("kind", Text, nullable=False),
    Column("name", Text, nullable=False),
    Column("output_schema", JSONB, nullable=False),
    Column("prompt_template", Text, nullable=False),
    Column("render_template", Text, nullable=False),
    Column("verifiers", ARRAY(Text()), nullable=False, server_default=text("'{}'::text[]")),
    Column("enabled", Boolean, nullable=False, server_default=text("true")),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("updated_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="content_templates_org_id_organizations_id_fk",
    ),
    PrimaryKeyConstraint("id", name="content_templates_pkey"),
    UniqueConstraint("org_id", "kind", "name", name="content_templates_orgId_kind_name_unique"),
    schema="public",
)

t_exams = Table(
    "exams",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("org_id", Uuid, nullable=False),
    Column("code", Text, nullable=False),
    Column("name_en", Text, nullable=False),
    Column("name_hi", Text),
    Column("authoritative_language", Text, nullable=False, server_default=text("'en'::text")),
    Column("meta", JSONB, nullable=False, server_default=text("'{}'::jsonb")),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("updated_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("family", Text),
    Column("paper_code", Text),
    ForeignKeyConstraint(
        ["org_id"], ["public.organizations.id"], ondelete="CASCADE", name="exams_org_id_organizations_id_fk"
    ),
    PrimaryKeyConstraint("id", name="exams_pkey"),
    UniqueConstraint("org_id", "code", name="exams_orgId_code_unique"),
    schema="public",
)

t_feedback = Table(
    "feedback",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("org_id", Uuid, nullable=False),
    Column("user_id", Uuid, nullable=False),
    Column("target_type", Text, nullable=False),
    Column("target_id", Uuid, nullable=False),
    Column("rating", SmallInteger),
    Column("reason", Text),
    Column("diff", JSONB),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="feedback_org_id_organizations_id_fk",
    ),
    ForeignKeyConstraint(["user_id"], ["public.users.id"], name="feedback_user_id_users_id_fk"),
    PrimaryKeyConstraint("id", name="feedback_pkey"),
    Index("feedback_org_id_target_type_index", "org_id", "target_type"),
    schema="public",
)

t_index_outbox = Table(
    "index_outbox",
    metadata,
    Column(
        "id",
        BigInteger,
        Identity(
            always=True, start=1, increment=1, minvalue=1, maxvalue=9223372036854775807, cycle=False, cache=1
        ),
        primary_key=True,
        autoincrement=True,
    ),
    Column("org_id", Uuid, nullable=False),
    Column("entity", Text, nullable=False),
    Column("entity_id", Uuid, nullable=False),
    Column("op", Text, nullable=False),
    Column("payload", JSONB, nullable=False, server_default=text("'{}'::jsonb")),
    Column("attempts", Integer, nullable=False, server_default=text("0")),
    Column("last_error", Text),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("processed_at", DateTime(True)),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="index_outbox_org_id_organizations_id_fk",
    ),
    PrimaryKeyConstraint("id", name="index_outbox_pkey"),
    Index("index_outbox_processed_at_id_index", "processed_at", "id"),
    schema="public",
)

t_ingest_batches = Table(
    "ingest_batches",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("org_id", Uuid, nullable=False),
    Column("name", Text, nullable=False),
    Column("manifest_s_3_key", Text),
    Column("file_count", Integer, nullable=False, server_default=text("0")),
    Column("uploaded_by", Uuid),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="ingest_batches_org_id_organizations_id_fk",
    ),
    ForeignKeyConstraint(
        ["uploaded_by"],
        ["public.users.id"],
        ondelete="SET NULL",
        name="ingest_batches_uploaded_by_users_id_fk",
    ),
    PrimaryKeyConstraint("id", name="ingest_batches_pkey"),
    schema="public",
)

t_invitations = Table(
    "invitations",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("organization_id", Uuid, nullable=False),
    Column("email", Text, nullable=False),
    Column("role", Text),
    Column("status", Text, nullable=False, server_default=text("'pending'::text")),
    Column("expires_at", DateTime, nullable=False),
    Column("created_at", DateTime, nullable=False, server_default=text("now()")),
    Column("inviter_id", Uuid, nullable=False),
    ForeignKeyConstraint(
        ["inviter_id"], ["public.users.id"], ondelete="CASCADE", name="invitations_inviter_id_users_id_fk"
    ),
    ForeignKeyConstraint(
        ["organization_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="invitations_organization_id_organizations_id_fk",
    ),
    PrimaryKeyConstraint("id", name="invitations_pkey"),
    Index("invitations_email_idx", "email"),
    Index("invitations_organizationId_idx", "organization_id"),
    schema="public",
)

t_llm_batches = Table(
    "llm_batches",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("org_id", Uuid, nullable=False),
    Column("provider", Text, nullable=False),
    Column("provider_batch_id", Text, nullable=False),
    Column("task", Text, nullable=False),
    Column("status", Text, nullable=False),
    Column("request_count", Integer, nullable=False),
    Column("submitted_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("ended_at", DateTime(True)),
    Column("collected_at", DateTime(True)),
    Column("meta", JSONB, nullable=False, server_default=text("'{}'::jsonb")),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="llm_batches_org_id_organizations_id_fk",
    ),
    PrimaryKeyConstraint("id", name="llm_batches_pkey"),
    UniqueConstraint("provider", "provider_batch_id", name="llm_batches_provider_providerBatchId_unique"),
    Index("llm_batches_status_index", "status"),
    schema="public",
)

t_llm_calls = Table(
    "llm_calls",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("org_id", Uuid, nullable=False),
    Column("user_id", Uuid),
    Column("task", Text, nullable=False),
    Column("provider", Text, nullable=False),
    Column("model_id", Text, nullable=False),
    Column("prompt_version", Text),
    Column("input_tokens", Integer, nullable=False),
    Column("cache_write_tokens", Integer, nullable=False),
    Column("cache_read_tokens", Integer, nullable=False),
    Column("output_tokens", Integer, nullable=False),
    Column("cost_usd", Numeric(12, 6), nullable=False),
    Column("latency_ms", Integer, nullable=False),
    Column("is_batch", Boolean, nullable=False, server_default=text("false")),
    Column("stop_reason", Text),
    Column("request_id", Text),
    Column("error", Text),
    Column("chat_session_id", Uuid),
    Column("document_id", Uuid),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("turn_id", Uuid),
    Column("workflow_id", Text),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="llm_calls_org_id_organizations_id_fk",
    ),
    ForeignKeyConstraint(
        ["user_id"], ["public.users.id"], ondelete="SET NULL", name="llm_calls_user_id_users_id_fk"
    ),
    PrimaryKeyConstraint("id", name="llm_calls_pkey"),
    Index("llm_calls_org_id_created_at_index", "org_id", "created_at"),
    schema="public",
)

t_members = Table(
    "members",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("organization_id", Uuid, nullable=False),
    Column("user_id", Uuid, nullable=False),
    Column("role", Text, nullable=False, server_default=text("'member'::text")),
    Column("created_at", DateTime, nullable=False),
    ForeignKeyConstraint(
        ["organization_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="members_organization_id_organizations_id_fk",
    ),
    ForeignKeyConstraint(
        ["user_id"], ["public.users.id"], ondelete="CASCADE", name="members_user_id_users_id_fk"
    ),
    PrimaryKeyConstraint("id", name="members_pkey"),
    Index("members_organizationId_idx", "organization_id"),
    Index("members_userId_idx", "user_id"),
    schema="public",
)

t_org_settings = Table(
    "org_settings",
    metadata,
    Column("org_id", Uuid, primary_key=True),
    Column("branding", JSONB, nullable=False, server_default=text("'{}'::jsonb")),
    Column("ai_policy", JSONB, nullable=False, server_default=text("'{}'::jsonb")),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("updated_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="org_settings_org_id_organizations_id_fk",
    ),
    PrimaryKeyConstraint("org_id", name="org_settings_pkey"),
    schema="public",
)

t_prompt_templates = Table(
    "prompt_templates",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("name", Text, nullable=False),
    Column("model_family", Text, nullable=False),
    Column("version", Integer, nullable=False),
    Column("body", Text, nullable=False),
    Column("is_active", Boolean, nullable=False, server_default=text("false")),
    Column("created_by", Uuid),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["created_by"],
        ["public.users.id"],
        ondelete="SET NULL",
        name="prompt_templates_created_by_users_id_fk",
    ),
    PrimaryKeyConstraint("id", name="prompt_templates_pkey"),
    UniqueConstraint(
        "name", "model_family", "version", name="prompt_templates_name_modelFamily_version_unique"
    ),
    schema="public",
)

t_quotas = Table(
    "quotas",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("org_id", Uuid, nullable=False),
    Column("user_id", Uuid),
    Column("monthly_limit_usd", Numeric(10, 2), nullable=False),
    Column("soft_limit_pct", Integer, nullable=False, server_default=text("80")),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("updated_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["org_id"], ["public.organizations.id"], ondelete="CASCADE", name="quotas_org_id_organizations_id_fk"
    ),
    ForeignKeyConstraint(
        ["user_id"], ["public.users.id"], ondelete="CASCADE", name="quotas_user_id_users_id_fk"
    ),
    PrimaryKeyConstraint("id", name="quotas_pkey"),
    UniqueConstraint("org_id", "user_id", name="quotas_orgId_userId_unique"),
    schema="public",
)

t_sessions = Table(
    "sessions",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("expires_at", DateTime, nullable=False),
    Column("token", Text, nullable=False),
    Column("created_at", DateTime, nullable=False, server_default=text("now()")),
    Column("updated_at", DateTime, nullable=False),
    Column("ip_address", Text),
    Column("user_agent", Text),
    Column("user_id", Uuid, nullable=False),
    Column("impersonated_by", Text),
    Column("active_organization_id", Text),
    ForeignKeyConstraint(
        ["user_id"], ["public.users.id"], ondelete="CASCADE", name="sessions_user_id_users_id_fk"
    ),
    PrimaryKeyConstraint("id", name="sessions_pkey"),
    UniqueConstraint("token", name="sessions_token_unique"),
    Index("sessions_userId_idx", "user_id"),
    schema="public",
)

t_task_routes = Table(
    "task_routes",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("task", Text, nullable=False),
    Column("org_id", Uuid),
    Column("model_id", Text, nullable=False),
    Column("effort", Text),
    Column("max_tokens", Integer, nullable=False),
    Column("fallback_model_id", Text),
    Column("options", JSONB, nullable=False, server_default=text("'{}'::jsonb")),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("updated_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["fallback_model_id"], ["public.llm_models.id"], name="task_routes_fallback_model_id_llm_models_id_fk"
    ),
    ForeignKeyConstraint(
        ["model_id"], ["public.llm_models.id"], name="task_routes_model_id_llm_models_id_fk"
    ),
    PrimaryKeyConstraint("id", name="task_routes_pkey"),
    UniqueConstraint("task", "org_id", name="task_routes_task_orgId_unique"),
    schema="public",
)

t_taxonomy_nodes = Table(
    "taxonomy_nodes",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("org_id", Uuid, nullable=False),
    Column("parent_id", Uuid),
    Column("level", Text, nullable=False),
    Column("name_en", Text, nullable=False),
    Column("name_hi", Text),
    Column("aliases", ARRAY(Text()), nullable=False, server_default=text("'{}'::text[]")),
    Column("sort_order", Integer, nullable=False, server_default=text("0")),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("updated_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("code", Text, nullable=False),
    Column("is_active", Boolean, nullable=False, server_default=text("true")),
    Column("meta", JSONB, nullable=False, server_default=text("'{}'::jsonb")),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="taxonomy_nodes_org_id_organizations_id_fk",
    ),
    ForeignKeyConstraint(
        ["parent_id"],
        ["public.taxonomy_nodes.id"],
        ondelete="CASCADE",
        name="taxonomy_nodes_parent_id_taxonomy_nodes_id_fk",
    ),
    PrimaryKeyConstraint("id", name="taxonomy_nodes_pkey"),
    UniqueConstraint("org_id", "parent_id", "code", name="taxonomy_nodes_orgId_parentId_code_unique"),
    Index("taxonomy_nodes_org_id_parent_id_index", "org_id", "parent_id"),
    schema="public",
)

t_exam_blueprints = Table(
    "exam_blueprints",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("org_id", Uuid, nullable=False),
    Column("exam_id", Uuid, nullable=False),
    Column("name", Text, nullable=False),
    Column("version", Integer, nullable=False, server_default=text("1")),
    Column("spec", JSONB, nullable=False),
    Column("is_active", Boolean, nullable=False, server_default=text("true")),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("updated_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["exam_id"], ["public.exams.id"], ondelete="CASCADE", name="exam_blueprints_exam_id_exams_id_fk"
    ),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="exam_blueprints_org_id_organizations_id_fk",
    ),
    PrimaryKeyConstraint("id", name="exam_blueprints_pkey"),
    UniqueConstraint("exam_id", "name", "version", name="exam_blueprints_examId_name_version_unique"),
    schema="public",
)

t_exam_syllabus = Table(
    "exam_syllabus",
    metadata,
    Column("org_id", Uuid, nullable=False),
    Column("exam_id", Uuid, primary_key=True),
    Column("node_id", Uuid, primary_key=True),
    Column("weightage", REAL),
    ForeignKeyConstraint(
        ["exam_id"], ["public.exams.id"], ondelete="CASCADE", name="exam_syllabus_exam_id_exams_id_fk"
    ),
    ForeignKeyConstraint(
        ["node_id"],
        ["public.taxonomy_nodes.id"],
        ondelete="CASCADE",
        name="exam_syllabus_node_id_taxonomy_nodes_id_fk",
    ),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="exam_syllabus_org_id_organizations_id_fk",
    ),
    PrimaryKeyConstraint("exam_id", "node_id", name="exam_syllabus_exam_id_node_id_pk"),
    schema="public",
)

t_glossary_terms = Table(
    "glossary_terms",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("org_id", Uuid, nullable=False),
    Column("term_en", Text, nullable=False),
    Column("term_hi", Text, nullable=False),
    Column("subject_node_id", Uuid),
    Column("source", Text, nullable=False),
    Column("approved", Boolean, nullable=False, server_default=text("false")),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("updated_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="glossary_terms_org_id_organizations_id_fk",
    ),
    ForeignKeyConstraint(
        ["subject_node_id"],
        ["public.taxonomy_nodes.id"],
        ondelete="SET NULL",
        name="glossary_terms_subject_node_id_taxonomy_nodes_id_fk",
    ),
    PrimaryKeyConstraint("id", name="glossary_terms_pkey"),
    UniqueConstraint("org_id", "term_en", "term_hi", name="glossary_terms_orgId_termEn_termHi_unique"),
    schema="public",
)

t_member_settings = Table(
    "member_settings",
    metadata,
    Column("org_id", Uuid, primary_key=True),
    Column("user_id", Uuid, primary_key=True),
    Column("ui_locale", Text, nullable=False, server_default=text("'en'::text")),
    Column("content_language", Text, nullable=False, server_default=text("'bilingual'::text")),
    Column("default_model_id", Text),
    Column("default_exam_id", Uuid),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("updated_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["default_exam_id"],
        ["public.exams.id"],
        ondelete="SET NULL",
        name="member_settings_default_exam_id_exams_id_fk",
    ),
    ForeignKeyConstraint(
        ["default_model_id"],
        ["public.llm_models.id"],
        ondelete="SET NULL",
        name="member_settings_default_model_id_llm_models_id_fk",
    ),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="member_settings_org_id_organizations_id_fk",
    ),
    ForeignKeyConstraint(
        ["user_id"], ["public.users.id"], ondelete="CASCADE", name="member_settings_user_id_users_id_fk"
    ),
    PrimaryKeyConstraint("org_id", "user_id", name="member_settings_org_id_user_id_pk"),
    schema="public",
)

t_member_subjects = Table(
    "member_subjects",
    metadata,
    Column("org_id", Uuid, nullable=False),
    Column("user_id", Uuid, primary_key=True),
    Column("subject_node_id", Uuid, primary_key=True),
    Column("exam_id", Uuid),
    Column("is_head", Boolean, nullable=False, server_default=text("false")),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["exam_id"], ["public.exams.id"], ondelete="SET NULL", name="member_subjects_exam_id_exams_id_fk"
    ),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="member_subjects_org_id_organizations_id_fk",
    ),
    ForeignKeyConstraint(
        ["subject_node_id"],
        ["public.taxonomy_nodes.id"],
        ondelete="CASCADE",
        name="member_subjects_subject_node_id_taxonomy_nodes_id_fk",
    ),
    ForeignKeyConstraint(
        ["user_id"], ["public.users.id"], ondelete="CASCADE", name="member_subjects_user_id_users_id_fk"
    ),
    PrimaryKeyConstraint("user_id", "subject_node_id", name="member_subjects_user_id_subject_node_id_pk"),
    Index("member_subjects_org_id_subject_node_id_index", "org_id", "subject_node_id"),
    schema="public",
)

t_questions = Table(
    "questions",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("org_id", Uuid, nullable=False),
    Column("qtype", Text, nullable=False),
    Column("origin", Text, nullable=False),
    Column("status", Text, nullable=False, server_default=text("'draft'::text")),
    Column("content", JSONB, nullable=False),
    Column("authoritative_language", Text, nullable=False),
    Column("answer", JSONB, nullable=False),
    Column("marks", Numeric(6, 2)),
    Column("negative_marks", Numeric(6, 2)),
    Column("difficulty", SmallInteger),
    Column("bloom_level", Text),
    Column("exam_id", Uuid),
    Column("year", SmallInteger),
    Column("passage_id", Uuid),
    Column("figure_asset_ids", ARRAY(Uuid()), nullable=False, server_default=text("'{}'::uuid[]")),
    Column("licence", Text, nullable=False),
    Column("provenance", JSONB, nullable=False, server_default=text("'{}'::jsonb")),
    Column("verification", JSONB, nullable=False, server_default=text("'{}'::jsonb")),
    Column("created_by", Uuid),
    Column("approved_by", Uuid),
    Column("usage_count", Integer, nullable=False, server_default=text("0")),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("updated_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("topics_checked_at", DateTime(True)),
    ForeignKeyConstraint(
        ["approved_by"], ["public.users.id"], ondelete="SET NULL", name="questions_approved_by_users_id_fk"
    ),
    ForeignKeyConstraint(
        ["created_by"], ["public.users.id"], ondelete="SET NULL", name="questions_created_by_users_id_fk"
    ),
    ForeignKeyConstraint(
        ["exam_id"], ["public.exams.id"], ondelete="SET NULL", name="questions_exam_id_exams_id_fk"
    ),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="questions_org_id_organizations_id_fk",
    ),
    ForeignKeyConstraint(
        ["passage_id"],
        ["public.questions.id"],
        ondelete="CASCADE",
        name="questions_passage_id_questions_id_fk",
    ),
    PrimaryKeyConstraint("id", name="questions_pkey"),
    Index("questions_org_id_status_origin_index", "org_id", "status", "origin"),
    schema="public",
)

t_sources = Table(
    "sources",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("org_id", Uuid, nullable=False),
    Column("sha256", Text, nullable=False),
    Column("filename", Text, nullable=False),
    Column("s3_key", Text, nullable=False),
    Column("mime_type", Text, nullable=False),
    Column("size_bytes", BigInteger, nullable=False),
    Column("kind", Text, nullable=False),
    Column("licence", Text, nullable=False),
    Column("language", Text),
    Column("parallel_group_id", Uuid),
    Column("meta", JSONB, nullable=False, server_default=text("'{}'::jsonb")),
    Column("stage", Text, nullable=False, server_default=text("'uploaded'::text")),
    Column("status", Text, nullable=False, server_default=text("'pending'::text")),
    Column("error", Text),
    Column("page_count", Integer),
    Column("duration_seconds", Integer),
    Column("uploaded_by", Uuid),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("updated_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("title", Text),
    Column("subject_node_id", Uuid),
    Column("exam_codes", ARRAY(Text()), nullable=False, server_default=text("'{}'::text[]")),
    Column("class_level", Text),
    Column("year", SmallInteger),
    Column("set_code", Text),
    Column("answer_key_for_source_id", Uuid),
    Column("page_offset", Integer),
    Column("font_hint", Text),
    Column("manifest_batch_id", Uuid),
    ForeignKeyConstraint(
        ["answer_key_for_source_id"],
        ["public.sources.id"],
        ondelete="SET NULL",
        name="sources_answer_key_for_source_id_sources_id_fk",
    ),
    ForeignKeyConstraint(
        ["manifest_batch_id"],
        ["public.ingest_batches.id"],
        ondelete="SET NULL",
        name="sources_manifest_batch_id_ingest_batches_id_fk",
    ),
    ForeignKeyConstraint(
        ["org_id"], ["public.organizations.id"], ondelete="CASCADE", name="sources_org_id_organizations_id_fk"
    ),
    ForeignKeyConstraint(
        ["subject_node_id"],
        ["public.taxonomy_nodes.id"],
        ondelete="SET NULL",
        name="sources_subject_node_id_taxonomy_nodes_id_fk",
    ),
    ForeignKeyConstraint(
        ["uploaded_by"], ["public.users.id"], ondelete="SET NULL", name="sources_uploaded_by_users_id_fk"
    ),
    PrimaryKeyConstraint("id", name="sources_pkey"),
    UniqueConstraint("org_id", "sha256", name="sources_orgId_sha256_unique"),
    Index("sources_org_id_stage_index", "org_id", "stage"),
    schema="public",
)

t_student_batches = Table(
    "student_batches",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("org_id", Uuid, nullable=False),
    Column("name", Text, nullable=False),
    Column("exam_id", Uuid),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("updated_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["exam_id"], ["public.exams.id"], ondelete="SET NULL", name="student_batches_exam_id_exams_id_fk"
    ),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="student_batches_org_id_organizations_id_fk",
    ),
    PrimaryKeyConstraint("id", name="student_batches_pkey"),
    UniqueConstraint("org_id", "name", name="student_batches_orgId_name_unique"),
    schema="public",
)

t_documents = Table(
    "documents",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("org_id", Uuid, nullable=False),
    Column("kind", Text, nullable=False),
    Column("title", Text, nullable=False),
    Column("template_id", Uuid),
    Column("spec", JSONB, nullable=False, server_default=text("'{}'::jsonb")),
    Column("content", JSONB, nullable=False, server_default=text("'{}'::jsonb")),
    Column("current_version", Integer, nullable=False, server_default=text("0")),
    Column("status", Text, nullable=False, server_default=text("'draft'::text")),
    Column("owner_id", Uuid, nullable=False),
    Column("student_batch_id", Uuid),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("updated_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("exam_id", Uuid),
    Column("subject_node_id", Uuid),
    ForeignKeyConstraint(
        ["exam_id"], ["public.exams.id"], ondelete="SET NULL", name="documents_exam_id_exams_id_fk"
    ),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="documents_org_id_organizations_id_fk",
    ),
    ForeignKeyConstraint(["owner_id"], ["public.users.id"], name="documents_owner_id_users_id_fk"),
    ForeignKeyConstraint(
        ["student_batch_id"],
        ["public.student_batches.id"],
        ondelete="SET NULL",
        name="documents_student_batch_id_student_batches_id_fk",
    ),
    ForeignKeyConstraint(
        ["subject_node_id"],
        ["public.taxonomy_nodes.id"],
        ondelete="SET NULL",
        name="documents_subject_node_id_taxonomy_nodes_id_fk",
    ),
    ForeignKeyConstraint(
        ["template_id"], ["public.content_templates.id"], name="documents_template_id_content_templates_id_fk"
    ),
    PrimaryKeyConstraint("id", name="documents_pkey"),
    Index("documents_org_id_owner_id_index", "org_id", "owner_id"),
    schema="public",
)

t_item_exposure = Table(
    "item_exposure",
    metadata,
    Column("org_id", Uuid, nullable=False),
    Column("question_id", Uuid, primary_key=True),
    Column("student_batch_id", Uuid, primary_key=True),
    Column("document_id", Uuid),
    Column("exposed_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="item_exposure_org_id_organizations_id_fk",
    ),
    ForeignKeyConstraint(
        ["question_id"],
        ["public.questions.id"],
        ondelete="CASCADE",
        name="item_exposure_question_id_questions_id_fk",
    ),
    ForeignKeyConstraint(
        ["student_batch_id"],
        ["public.student_batches.id"],
        ondelete="CASCADE",
        name="item_exposure_student_batch_id_student_batches_id_fk",
    ),
    PrimaryKeyConstraint(
        "question_id", "student_batch_id", name="item_exposure_question_id_student_batch_id_pk"
    ),
    Index("item_exposure_student_batch_id_index", "student_batch_id"),
    schema="public",
)

t_pages = Table(
    "pages",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("org_id", Uuid, nullable=False),
    Column("source_id", Uuid, nullable=False),
    Column("page_no", Integer, nullable=False),
    Column("method", Text, nullable=False),
    Column("content_md", Text, nullable=False, server_default=text("''::text")),
    Column("confidence", REAL),
    Column("review_status", Text, nullable=False, server_default=text("'not_needed'::text")),
    Column("image_s_3_key", Text),
    Column("meta", JSONB, nullable=False, server_default=text("'{}'::jsonb")),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("updated_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("page_label", Text),
    Column("extractor_version", Text),
    ForeignKeyConstraint(
        ["org_id"], ["public.organizations.id"], ondelete="CASCADE", name="pages_org_id_organizations_id_fk"
    ),
    ForeignKeyConstraint(
        ["source_id"], ["public.sources.id"], ondelete="CASCADE", name="pages_source_id_sources_id_fk"
    ),
    PrimaryKeyConstraint("id", name="pages_pkey"),
    UniqueConstraint("source_id", "page_no", name="pages_sourceId_pageNo_unique"),
    Index("pages_org_id_review_status_index", "org_id", "review_status"),
    schema="public",
)

t_pipeline_runs = Table(
    "pipeline_runs",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("org_id", Uuid, nullable=False),
    Column("source_id", Uuid, nullable=False),
    Column("stage", Text, nullable=False),
    Column("status", Text, nullable=False, server_default=text("'pending'::text")),
    Column("attempt", Integer, nullable=False, server_default=text("0")),
    Column("job_id", Text),
    Column("started_at", DateTime(True)),
    Column("finished_at", DateTime(True)),
    Column("error", Text),
    Column("meta", JSONB, nullable=False, server_default=text("'{}'::jsonb")),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="pipeline_runs_org_id_organizations_id_fk",
    ),
    ForeignKeyConstraint(
        ["source_id"], ["public.sources.id"], ondelete="CASCADE", name="pipeline_runs_source_id_sources_id_fk"
    ),
    PrimaryKeyConstraint("id", name="pipeline_runs_pkey"),
    UniqueConstraint("source_id", "stage", name="pipeline_runs_sourceId_stage_unique"),
    Index("pipeline_runs_status_index", "status"),
    schema="public",
)

t_pyq_refs = Table(
    "pyq_refs",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("org_id", Uuid, nullable=False),
    Column("question_id", Uuid, nullable=False),
    Column("source_id", Uuid, nullable=False),
    Column("set_code", Text, nullable=False, server_default=text("''::text")),
    Column("question_no", Integer, nullable=False),
    Column("key_answer", JSONB),
    Column("key_status", Text),
    Column("key_source_id", Uuid),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["key_source_id"],
        ["public.sources.id"],
        ondelete="SET NULL",
        name="pyq_refs_key_source_id_sources_id_fk",
    ),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="pyq_refs_org_id_organizations_id_fk",
    ),
    ForeignKeyConstraint(
        ["question_id"],
        ["public.questions.id"],
        ondelete="CASCADE",
        name="pyq_refs_question_id_questions_id_fk",
    ),
    ForeignKeyConstraint(
        ["source_id"], ["public.sources.id"], ondelete="CASCADE", name="pyq_refs_source_id_sources_id_fk"
    ),
    PrimaryKeyConstraint("id", name="pyq_refs_pkey"),
    UniqueConstraint(
        "source_id", "set_code", "question_no", name="pyq_refs_sourceId_setCode_questionNo_unique"
    ),
    Index("pyq_refs_question_id_index", "question_id"),
    schema="public",
)

t_question_tags = Table(
    "question_tags",
    metadata,
    Column("org_id", Uuid, nullable=False),
    Column("question_id", Uuid, primary_key=True),
    Column("node_id", Uuid, primary_key=True),
    Column("confidence", REAL),
    Column("method", Text, nullable=False),
    Column("tagger_version", Text),
    Column("is_primary", Boolean, nullable=False, server_default=text("false")),
    ForeignKeyConstraint(
        ["node_id"],
        ["public.taxonomy_nodes.id"],
        ondelete="CASCADE",
        name="question_tags_node_id_taxonomy_nodes_id_fk",
    ),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="question_tags_org_id_organizations_id_fk",
    ),
    ForeignKeyConstraint(
        ["question_id"],
        ["public.questions.id"],
        ondelete="CASCADE",
        name="question_tags_question_id_questions_id_fk",
    ),
    PrimaryKeyConstraint("question_id", "node_id", name="question_tags_question_id_node_id_pk"),
    Index("question_tags_node_id_index", "node_id"),
    schema="public",
)

t_source_sections = Table(
    "source_sections",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("org_id", Uuid, nullable=False),
    Column("source_id", Uuid, nullable=False),
    Column("parent_id", Uuid),
    Column("title", Text, nullable=False),
    Column("page_start", Integer),
    Column("page_end", Integer),
    Column("node_id", Uuid),
    Column("origin", Text, nullable=False),
    Column("confidence", REAL),
    Column("position", Integer, nullable=False),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["node_id"],
        ["public.taxonomy_nodes.id"],
        ondelete="SET NULL",
        name="source_sections_node_id_taxonomy_nodes_id_fk",
    ),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="source_sections_org_id_organizations_id_fk",
    ),
    ForeignKeyConstraint(
        ["parent_id"],
        ["public.source_sections.id"],
        ondelete="CASCADE",
        name="source_sections_parent_id_source_sections_id_fk",
    ),
    ForeignKeyConstraint(
        ["source_id"],
        ["public.sources.id"],
        ondelete="CASCADE",
        name="source_sections_source_id_sources_id_fk",
    ),
    PrimaryKeyConstraint("id", name="source_sections_pkey"),
    UniqueConstraint("source_id", "position", name="source_sections_sourceId_position_unique"),
    schema="public",
)

t_assets = Table(
    "assets",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("org_id", Uuid, nullable=False),
    Column("source_id", Uuid),
    Column("page_id", Uuid),
    Column("kind", Text, nullable=False),
    Column("s3_key", Text, nullable=False),
    Column("bbox", JSONB),
    Column("caption", Text),
    Column("description", Text),
    Column("smiles", Text),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["org_id"], ["public.organizations.id"], ondelete="CASCADE", name="assets_org_id_organizations_id_fk"
    ),
    ForeignKeyConstraint(
        ["page_id"], ["public.pages.id"], ondelete="CASCADE", name="assets_page_id_pages_id_fk"
    ),
    ForeignKeyConstraint(
        ["source_id"], ["public.sources.id"], ondelete="CASCADE", name="assets_source_id_sources_id_fk"
    ),
    PrimaryKeyConstraint("id", name="assets_pkey"),
    Index("assets_source_id_index", "source_id"),
    schema="public",
)

t_chat_sessions = Table(
    "chat_sessions",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("org_id", Uuid, nullable=False),
    Column("user_id", Uuid, nullable=False),
    Column("document_id", Uuid),
    Column("title", Text, nullable=False, server_default=text("''::text")),
    Column("model_override", Text),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("updated_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("draft_spec", JSONB),
    Column("status", Text, nullable=False, server_default=text("'idle'::text")),
    Column("pinned", Boolean, nullable=False, server_default=text("false")),
    Column("archived_at", DateTime(True)),
    ForeignKeyConstraint(
        ["document_id"],
        ["public.documents.id"],
        ondelete="SET NULL",
        name="chat_sessions_document_id_documents_id_fk",
    ),
    ForeignKeyConstraint(
        ["model_override"], ["public.llm_models.id"], name="chat_sessions_model_override_llm_models_id_fk"
    ),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="chat_sessions_org_id_organizations_id_fk",
    ),
    ForeignKeyConstraint(["user_id"], ["public.users.id"], name="chat_sessions_user_id_users_id_fk"),
    PrimaryKeyConstraint("id", name="chat_sessions_pkey"),
    Index("chat_sessions_org_id_user_id_index", "org_id", "user_id"),
    schema="public",
)

t_chunks = Table(
    "chunks",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("org_id", Uuid, nullable=False),
    Column("source_id", Uuid, nullable=False),
    Column("parent_id", Uuid),
    Column("page_start", Integer),
    Column("page_end", Integer),
    Column("start_ms", Integer),
    Column("end_ms", Integer),
    Column("text", Text, nullable=False),
    Column("context_header", Text),
    Column("language", Text, nullable=False),
    Column("token_count", Integer, nullable=False),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("position", Integer, nullable=False),
    Column("section_id", Uuid),
    Column("heading_path", Text),
    Column("kind", Text, nullable=False, server_default=text("'prose'::text")),
    Column("content_hash", Text),
    Column("chunker_version", Text),
    Column("embedding_version_id", Text),
    Column("indexed_at", DateTime(True)),
    Column("topics_checked_at", DateTime(True)),
    ForeignKeyConstraint(
        ["embedding_version_id"],
        ["public.embedding_versions.id"],
        name="chunks_embedding_version_id_embedding_versions_id_fk",
    ),
    ForeignKeyConstraint(
        ["org_id"], ["public.organizations.id"], ondelete="CASCADE", name="chunks_org_id_organizations_id_fk"
    ),
    ForeignKeyConstraint(
        ["parent_id"], ["public.chunks.id"], ondelete="CASCADE", name="chunks_parent_id_chunks_id_fk"
    ),
    ForeignKeyConstraint(
        ["section_id"],
        ["public.source_sections.id"],
        ondelete="SET NULL",
        name="chunks_section_id_source_sections_id_fk",
    ),
    ForeignKeyConstraint(
        ["source_id"], ["public.sources.id"], ondelete="CASCADE", name="chunks_source_id_sources_id_fk"
    ),
    PrimaryKeyConstraint("id", name="chunks_pkey"),
    UniqueConstraint("source_id", "position", name="chunks_sourceId_position_unique"),
    schema="public",
)

t_comments = Table(
    "comments",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("org_id", Uuid, nullable=False),
    Column("document_id", Uuid, nullable=False),
    Column("item_id", Text),
    Column("user_id", Uuid, nullable=False),
    Column("body", Text, nullable=False),
    Column("resolved", Boolean, nullable=False, server_default=text("false")),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("updated_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["document_id"],
        ["public.documents.id"],
        ondelete="CASCADE",
        name="comments_document_id_documents_id_fk",
    ),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="comments_org_id_organizations_id_fk",
    ),
    ForeignKeyConstraint(["user_id"], ["public.users.id"], name="comments_user_id_users_id_fk"),
    PrimaryKeyConstraint("id", name="comments_pkey"),
    Index("comments_document_id_index", "document_id"),
    schema="public",
)

t_document_exports = Table(
    "document_exports",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("org_id", Uuid, nullable=False),
    Column("document_id", Uuid, nullable=False),
    Column("version", Integer, nullable=False),
    Column("format", Text, nullable=False),
    Column("variant", Text, nullable=False),
    Column("set_code", Text),
    Column("s3_key", Text),
    Column("status", Text, nullable=False, server_default=text("'pending'::text")),
    Column("error", Text),
    Column("created_by", Uuid),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("finished_at", DateTime(True)),
    ForeignKeyConstraint(
        ["created_by"],
        ["public.users.id"],
        ondelete="SET NULL",
        name="document_exports_created_by_users_id_fk",
    ),
    ForeignKeyConstraint(
        ["document_id"],
        ["public.documents.id"],
        ondelete="CASCADE",
        name="document_exports_document_id_documents_id_fk",
    ),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="document_exports_org_id_organizations_id_fk",
    ),
    PrimaryKeyConstraint("id", name="document_exports_pkey"),
    Index("document_exports_org_id_document_id_index", "org_id", "document_id"),
    schema="public",
)

t_chat_messages = Table(
    "chat_messages",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("org_id", Uuid, nullable=False),
    Column("session_id", Uuid, nullable=False),
    Column("seq", Integer, nullable=False),
    Column("role", Text, nullable=False),
    Column("content", JSONB, nullable=False),
    Column("provider_payload", JSONB),
    Column("model_id", Text),
    Column("llm_call_id", Uuid),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["llm_call_id"],
        ["public.llm_calls.id"],
        ondelete="SET NULL",
        name="chat_messages_llm_call_id_llm_calls_id_fk",
    ),
    ForeignKeyConstraint(
        ["model_id"], ["public.llm_models.id"], name="chat_messages_model_id_llm_models_id_fk"
    ),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="chat_messages_org_id_organizations_id_fk",
    ),
    ForeignKeyConstraint(
        ["session_id"],
        ["public.chat_sessions.id"],
        ondelete="CASCADE",
        name="chat_messages_session_id_chat_sessions_id_fk",
    ),
    PrimaryKeyConstraint("id", name="chat_messages_pkey"),
    UniqueConstraint("session_id", "seq", name="chat_messages_sessionId_seq_unique"),
    schema="public",
)

t_chunk_tags = Table(
    "chunk_tags",
    metadata,
    Column("org_id", Uuid, nullable=False),
    Column("chunk_id", Uuid, primary_key=True),
    Column("node_id", Uuid, primary_key=True),
    Column("confidence", REAL),
    Column("method", Text, nullable=False),
    Column("tagger_version", Text),
    Column("is_primary", Boolean, nullable=False, server_default=text("false")),
    ForeignKeyConstraint(
        ["chunk_id"], ["public.chunks.id"], ondelete="CASCADE", name="chunk_tags_chunk_id_chunks_id_fk"
    ),
    ForeignKeyConstraint(
        ["node_id"],
        ["public.taxonomy_nodes.id"],
        ondelete="CASCADE",
        name="chunk_tags_node_id_taxonomy_nodes_id_fk",
    ),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="chunk_tags_org_id_organizations_id_fk",
    ),
    PrimaryKeyConstraint("chunk_id", "node_id", name="chunk_tags_chunk_id_node_id_pk"),
    Index("chunk_tags_node_id_index", "node_id"),
    schema="public",
)

t_generation_runs = Table(
    "generation_runs",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("org_id", Uuid, nullable=False),
    Column("document_id", Uuid, nullable=False),
    Column("session_id", Uuid),
    Column("workflow_id", Text, nullable=False),
    Column("spec", JSONB, nullable=False),
    Column("slot_plan", JSONB, nullable=False, server_default=text("'[]'::jsonb")),
    Column("slot_states", JSONB, nullable=False, server_default=text("'{}'::jsonb")),
    Column("status", Text, nullable=False, server_default=text("'planning'::text")),
    Column("estimated_cost_usd", Numeric(12, 6)),
    Column("actual_cost_usd", Numeric(12, 6)),
    Column("error", Text),
    Column("started_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("finished_at", DateTime(True)),
    ForeignKeyConstraint(
        ["document_id"],
        ["public.documents.id"],
        ondelete="CASCADE",
        name="generation_runs_document_id_documents_id_fk",
    ),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="generation_runs_org_id_organizations_id_fk",
    ),
    ForeignKeyConstraint(
        ["session_id"],
        ["public.chat_sessions.id"],
        ondelete="SET NULL",
        name="generation_runs_session_id_chat_sessions_id_fk",
    ),
    PrimaryKeyConstraint("id", name="generation_runs_pkey"),
    UniqueConstraint("workflow_id", name="generation_runs_workflowId_unique"),
    Index("generation_runs_org_id_document_id_index", "org_id", "document_id"),
    schema="public",
)

t_chat_turns = Table(
    "chat_turns",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("org_id", Uuid, nullable=False),
    Column("session_id", Uuid, nullable=False),
    Column("client_turn_id", Text, nullable=False),
    Column("user_message_id", Uuid),
    Column("assistant_message_id", Uuid),
    Column("status", Text, nullable=False, server_default=text("'pending'::text")),
    Column("stream_key", Text),
    Column("error", Text),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    Column("finished_at", DateTime(True)),
    ForeignKeyConstraint(
        ["assistant_message_id"],
        ["public.chat_messages.id"],
        ondelete="SET NULL",
        name="chat_turns_assistant_message_id_chat_messages_id_fk",
    ),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="chat_turns_org_id_organizations_id_fk",
    ),
    ForeignKeyConstraint(
        ["session_id"],
        ["public.chat_sessions.id"],
        ondelete="CASCADE",
        name="chat_turns_session_id_chat_sessions_id_fk",
    ),
    ForeignKeyConstraint(
        ["user_message_id"],
        ["public.chat_messages.id"],
        ondelete="SET NULL",
        name="chat_turns_user_message_id_chat_messages_id_fk",
    ),
    PrimaryKeyConstraint("id", name="chat_turns_pkey"),
    UniqueConstraint("session_id", "client_turn_id", name="chat_turns_sessionId_clientTurnId_unique"),
    schema="public",
)

t_document_versions = Table(
    "document_versions",
    metadata,
    Column("id", Uuid, primary_key=True, server_default=text("gen_random_uuid()")),
    Column("org_id", Uuid, nullable=False),
    Column("document_id", Uuid, nullable=False),
    Column("version", Integer, nullable=False),
    Column("content", JSONB, nullable=False),
    Column("ops", JSONB, nullable=False, server_default=text("'[]'::jsonb")),
    Column("author_kind", Text, nullable=False),
    Column("author_id", Uuid),
    Column("chat_message_id", Uuid),
    Column("created_at", DateTime(True), nullable=False, server_default=text("now()")),
    ForeignKeyConstraint(
        ["author_id"],
        ["public.users.id"],
        ondelete="SET NULL",
        name="document_versions_author_id_users_id_fk",
    ),
    ForeignKeyConstraint(
        ["chat_message_id"],
        ["public.chat_messages.id"],
        ondelete="SET NULL",
        name="document_versions_chat_message_id_chat_messages_id_fk",
    ),
    ForeignKeyConstraint(
        ["document_id"],
        ["public.documents.id"],
        ondelete="CASCADE",
        name="document_versions_document_id_documents_id_fk",
    ),
    ForeignKeyConstraint(
        ["org_id"],
        ["public.organizations.id"],
        ondelete="CASCADE",
        name="document_versions_org_id_organizations_id_fk",
    ),
    PrimaryKeyConstraint("id", name="document_versions_pkey"),
    UniqueConstraint("document_id", "version", name="document_versions_documentId_version_unique"),
    schema="public",
)
