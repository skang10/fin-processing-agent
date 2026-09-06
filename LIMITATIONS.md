# Limitations

## Purpose

Financial Document AI Agent is a production-shaped machine learning prototype created for demonstration and evaluation. It is not a production banking system and must not be represented or used as one.

This document defines the known limitations of the initial release. These limitations are part of the product boundary and must remain visible in project documentation and demonstrations.

## Data

1. The initial release is designed and evaluated with synthetic and explicitly demo-safe data.
2. Real customer, banking, identity, or other personal financial data must not be used with the demo deployment.
3. Synthetic documents may resemble the structure of German financial documents, but they must be clearly marked as synthetic and must not reproduce official security features or real institution branding.
4. Reported machine learning results apply only to the documented dataset version and do not establish performance on real banking documents.
5. The project does not include an authorized representative production dataset or a production drift baseline.

## Regulatory and Business Use

1. The project has not been certified or approved for compliance with the General Data Protection Regulation (GDPR), German banking requirements, Federal Financial Supervisory Authority (BaFin) expectations, credit decision regulation, Anti-Money Laundering (AML), or Know Your Customer (KYC) obligations.
2. The system does not determine creditworthiness or make lending, account-opening, AML, KYC, or other regulated business decisions.
3. The system has no permission or interface to disburse funds, open accounts, reject applications, contact customers, or perform other core banking actions.
   The Review Workbench may record a human-reviewed, applicant-readable requested-change draft, but the V1 system does not send or deliver it.
4. A recommended disposition describes only the state of document processing and review. It is not a customer or credit decision.
5. The included validation rules are illustrative and must not be interpreted as the policy of a real financial institution.

## Security

1. The initial release provides basic file-type validation, resource limits, and isolated document parsing, but it does not include enterprise malware scanning or Content Disarm and Reconstruction (CDR).
2. The demo authentication mechanism is not a production identity and access management system.
3. The application audit trail is append-only at the application layer, but it is not tamper-proof and is not stored in Write Once Read Many (WORM) storage.
4. The project does not provide a completed production threat model, penetration test, privacy impact assessment, or security certification.
5. Prompt-injection controls reduce the authority of untrusted document content but do not claim to detect every malicious instruction.
6. Third-party models, libraries, native runtimes, and model assets require separate security, licensing, and supply-chain review before production use.

## Models and External Services

1. The initial release may call an externally hosted Vision Language Model (VLM) or Large Language Model (LLM).
2. No production data-processing agreement, deployment-region guarantee, retention guarantee, or private model endpoint is included with the project.
3. The model provider and model are replaceable through project gateways, but private-cloud and local-model adapters are not guaranteed to be implemented in the initial release.
4. Model output may be incomplete, inconsistent, or incorrect. Schema validation, evidence requirements, deterministic checks, and human review reduce but do not eliminate this risk.
5. Model confidence values are not assumed to be calibrated unless a documented evaluation and calibration version is attached.
6. The project does not train a proprietary foundation model. It evaluates and orchestrates pretrained components.
7. The default synthetic demo OCR mode emits deterministic fixture text for pipeline testing; it does not perform text recognition and its output must not be treated as OCR quality evidence. The PDF Inspector PP-OCRv6 Small adapter exists, but its offline runtime assets and platform deployment have not yet completed acceptance testing.

## Document and Scenario Coverage

1. The initial scenario is a single-applicant German personal-loan document-review demonstration.
2. Project documentation and application contracts use English. Input-document evaluation is limited to the documented German and English synthetic test set.
3. The initial release supports PDF, JPEG, and PNG inputs. Tagged Image File Format (TIFF) is outside the initial scope.
4. Core structured coverage is limited to application data, supported German identity documents, payslips, and bank statements.
5. Joint applications, self-employed applicants, pension or benefit income, complex ownership structures, and production KYC workflows are outside the initial scope.
6. Logical-document splitting is limited to contiguous page ranges within one physical PDF. The system does not automatically merge documents across files or reorder non-contiguous pages.
7. Currency normalization and validation are designed around Euro (EUR). Foreign-exchange conversion is not included.

## Validation and Agent Boundaries

1. Cross-document validation uses a finite, registered, versioned demonstration rule set. It is not a complete banking rule catalog.
2. Models may assist with extraction, ambiguous entity matching, and a non-authoritative case-review brief, but they cannot create or modify validation rules, determine authoritative findings or dispositions, or select a business decision.
3. The Pi-based Case Review Agent runs as one bounded pre-screening session for every processable case. It may use adaptive extraction tools only for scoped gaps. It cannot access a shell, arbitrary files, unrestricted networks, core banking systems, or policy mutation tools. The default demo and CI paths drive the embedded Pi harness with a deterministic scripted fake model rather than a real language model, so Agent review quality has not been measured. OCR and VLM tools in the demo return synthetic fixture values rather than recognizing anything, and the live model route has not completed acceptance. Agent steps, tool results, and consumed budgets are persisted as the session runs, so a lost Worker resumes from committed state; a tool call that completed but whose step had not yet committed may repeat, which is why the deterministic components it calls are idempotent for the run.
4. Agent suggestions are limited to registered document-review actions, must cite persisted evidence or findings, and require human confirmation; they are not credit, lending, AML, or KYC advice.
5. Cases with unresolved required evidence cannot be marked ready for downstream processing.
6. Human corrections are retained as dataset candidates but do not automatically update prompts, models, rules, or thresholds.

## Reliability and Operations

1. The initial release has no production Service Level Agreement (SLA), availability commitment, recovery-time objective, or recovery-point objective.
2. Performance, accuracy, latency, and cost figures are baselines measured on versioned synthetic datasets and documented hardware or service configurations.
3. Docker Compose is the supported demonstration deployment. Cloud deployment is an architectural compatibility goal, not a delivered production environment.
4. The project does not include high availability, multi-region replication, disaster recovery, autoscaling validation, or production capacity testing.
5. Data retention is simplified for demonstration use. Production retention, legal hold, deletion verification, and backup policies are not implemented.
6. External webhook delivery and integration with a core banking workflow are outside the initial release.

## Requirements Before Production Use

Before any production use, an adopting organization must at minimum:

1. Define and approve the exact business purpose, jurisdiction, document requirements, validation rules, and human-review responsibilities.
2. Complete legal, privacy, risk, compliance, security, model-risk, and third-party reviews.
3. Establish authorized representative datasets and validate performance across relevant customer groups, document sources, languages, templates, and quality conditions.
4. Calibrate confidence and routing thresholds against documented business impact.
5. Replace demo authentication and security controls with approved enterprise services.
6. Add malware scanning or CDR where required and complete adversarial document testing.
7. Approve model hosting, data location, retention, provider terms, and network controls.
8. Implement production data retention, deletion, backup, recovery, monitoring, incident response, and audit controls.
9. Perform load, resilience, failover, penetration, authorization, privacy, and user-acceptance testing.
10. Ensure that authorized external systems and personnel retain responsibility for every regulated or customer-impacting decision and action.
