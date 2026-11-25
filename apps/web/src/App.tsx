import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  FileText,
  FolderOpen,
  HeartPulse,
  LayoutDashboard,
  LockKeyhole,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pill,
  Search,
  Sun,
  TrendingUp,
  Upload,
  Users,
  UserRound,
} from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { ResourceState } from './components/ui/resource-state';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './components/ui/dialog';
import { useTheme } from './hooks/use-theme';
import { MedicalDocumentArt } from './components/overview/MedicalDocumentArt';
import { PatientPicker, usePatientContext } from './features/patients';
import { DocumentUploadForm, DocumentsPanel } from './features/documents';
import { TrendsPanel } from './features/measurements';
import { MedicationsPanel } from './features/medications';
import { FamilyAccessPanel } from './features/access';
import { captureIncomingLink } from './features/access/incoming-link';
import { DuplicateUploadNotice } from './features/documents/DuplicateUploadNotice';
import './styles.css';
import './overview.css';

const destinations = [
  { id: 'overview', label: 'Overview', short: 'Home', icon: LayoutDashboard },
  { id: 'documents', label: 'Documents', short: 'Docs', icon: FolderOpen },
  { id: 'trends', label: 'Trends', short: 'Trends', icon: TrendingUp },
  { id: 'medications', label: 'Medications', short: 'Meds', icon: Pill },
  { id: 'family-access', label: 'Family Access', short: 'Family', icon: Users },
];
const readDestination = () =>
  destinations.some(
    ({ id }) => id === window.location.hash.slice(1).split('?')[0],
  )
    ? window.location.hash.slice(1).split('?')[0]!
    : 'overview';
const states: Record<
  string,
  { title: string; description: string; note: string }
> = {
  documents: {
    title: 'Your records, in one place',
    description:
      'Select a patient to view their medical documents. Original records will be the starting point for their health history.',
    note: 'Documents are organized for the selected patient.',
  },
  trends: {
    title: 'A clearer view over time',
    description:
      'Select a patient to explore trends from verified medical records when they become available.',
    note: 'Clinical values need a source and context.',
  },
  medications: {
    title: 'Keep medications in context',
    description:
      'Select a patient to view medication information from their records when it becomes available.',
    note: 'Medication information belongs to the selected patient.',
  },
  'family-access': {
    title: 'Care starts with the right access',
    description:
      'Select a patient to view their family access information when it becomes available.',
    note: 'Access is specific to each patient.',
  },
};

export default function App() {
  const [destination, setDestination] = useState(readDestination);
  const [expanded, setExpanded] = useState(false);
  const [dialog, setDialog] = useState<'patient' | 'upload' | null>(null);
  const [uploadStep, setUploadStep] = useState<'patient' | 'files'>('patient');
  const [listRevision, setListRevision] = useState(0);
  const [searchDraft, setSearchDraft] = useState<{
    patientId: string;
    query: string;
  } | null>(null);
  const [documentSearch, setDocumentSearch] = useState<{
    patientId: string;
    query: string;
  } | null>(null);
  const consumeDocumentSearch = useCallback(() => setDocumentSearch(null), []);
  const [uploadNotice, setUploadNotice] = useState<{
    patientId: string;
    potentialDuplicate: boolean;
  } | null>(null);
  const { selectedPatient, loading: patientsLoading } = usePatientContext();
  useEffect(() => {
    if (patientsLoading) return;
    if (searchDraft && searchDraft.patientId !== selectedPatient?.id)
      setSearchDraft(null);
    if (documentSearch && documentSearch.patientId !== selectedPatient?.id)
      setDocumentSearch(null);
  }, [selectedPatient?.id, patientsLoading, searchDraft, documentSearch]);
  useEffect(() => {
    setUploadNotice(null);
  }, [selectedPatient?.id, patientsLoading]);
  const dialogTrigger = useRef<HTMLElement | null>(null);
  const dialogTitle = useRef<HTMLHeadingElement | null>(null);
  const focusUploadAfterSelection = useRef(false);
  useEffect(() => {
    if (dialog !== 'upload') {
      focusUploadAfterSelection.current = false;
      return;
    }
    if (!patientsLoading) {
      setUploadStep(selectedPatient ? 'files' : 'patient');
      if (!selectedPatient) focusUploadAfterSelection.current = false;
    }
    if (
      focusUploadAfterSelection.current &&
      selectedPatient &&
      !patientsLoading
    ) {
      focusUploadAfterSelection.current = false;
      dialogTitle.current?.focus({ preventScroll: true });
    }
  }, [dialog, selectedPatient, patientsLoading]);
  const openDialog = (kind: 'patient' | 'upload') => {
    focusUploadAfterSelection.current = false;
    if (kind === 'upload') setUploadStep(selectedPatient ? 'files' : 'patient');
    if (kind === 'upload') setUploadNotice(null);
    dialogTrigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setDialog(kind);
  };
  const { theme, toggleTheme } = useTheme();
  useEffect(() => {
    const onHashChange = () => {
      captureIncomingLink();
      const next = readDestination();
      if (next !== 'documents') setDocumentSearch(null);
      setDestination(next);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  const active = destinations.find(({ id }) => id === destination)!;
  const previousDestination = useRef(destination);
  useEffect(() => {
    document.title = `${active.label} | Family Medical Vault`;
    if (previousDestination.current !== destination) {
      previousDestination.current = destination;
      document.getElementById('page-title')?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [destination, active.label]);
  const currentState = states[destination];
  const navigation = (mobile = false) =>
    destinations.map(({ id, label, short, icon: Icon }) => (
      <a
        key={id}
        href={`#${id}`}
        aria-label={mobile && short !== label ? `${short} (${label})` : label}
        aria-current={destination === id ? 'page' : undefined}
        title={label}
        className="nav-link"
      >
        <Icon aria-hidden="true" size={20} />
        <span>{mobile ? short : label}</span>
      </a>
    ));
  return (
    <div
      className={`app-shell${expanded ? ' rail-expanded' : ''}${destination === 'overview' ? ' overview-screen' : ''}`}
    >
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Skip to main content
      </a>
      <aside className="desktop-rail" aria-label="Application sidebar">
        <a
          className="brand-mark"
          href="#overview"
          aria-label="Family Medical Vault overview"
        >
          <HeartPulse aria-hidden="true" size={25} />
          <span>Family Medical Vault</span>
        </a>
        <nav aria-label="Main navigation">{navigation()}</nav>
        <div className="rail-footer">
          <Button
            className="icon-button"
            variant="ghost"
            onClick={() => setExpanded(!expanded)}
            aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'}
          >
            {expanded ? <PanelLeftClose /> : <PanelLeftOpen />}
          </Button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <Button
            className="patient-switcher"
            variant="ghost"
            onClick={() => openDialog('patient')}
            aria-label={`Select patient: ${selectedPatient?.displayName ?? 'No patient selected'}`}
          >
            <span className="patient-avatar">
              <Users size={20} aria-hidden="true" />
            </span>
            <span className="patient-copy">
              <span className="control-label">Select patient</span>{' '}
              <span className="patient-name">
                {selectedPatient?.displayName ?? 'No patient selected'}
              </span>
            </span>
            <ChevronDown size={16} aria-hidden="true" />
          </Button>
          <div className="header-actions">
            <Button asChild variant="ghost" size="icon" aria-label="Account">
              <a href="#account">
                <UserRound aria-hidden="true" size={20} />
              </a>
            </Button>
            <Button
              variant="ghost"
              className="icon-button"
              onClick={toggleTheme}
              aria-label={
                theme === 'light'
                  ? 'Switch to dark theme'
                  : 'Switch to light theme'
              }
            >
              {theme === 'light' ? <Moon size={20} /> : <Sun size={20} />}
            </Button>
            <Button
              className="upload-button"
              onClick={() => openDialog('upload')}
            >
              <Upload size={18} aria-hidden="true" />
              <span>Upload</span>
            </Button>
          </div>
        </header>
        {destination !== 'documents' &&
          destination !== 'trends' &&
          destination !== 'medications' && (
            <div className="search-strip">
              <form
                className="search-field overview-search"
                role="search"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (
                    !selectedPatient ||
                    patientsLoading ||
                    searchDraft?.patientId !== selectedPatient.id ||
                    !searchDraft.query.trim()
                  )
                    return;
                  setDocumentSearch({
                    patientId: selectedPatient.id,
                    query: searchDraft.query.trim(),
                  });
                  setSearchDraft(null);
                  window.location.hash = 'documents';
                }}
              >
                <Search size={18} aria-hidden="true" />
                <Input
                  aria-label="Search documents"
                  aria-describedby="search-help"
                  placeholder="Search documents"
                  type="search"
                  maxLength={200}
                  autoComplete="off"
                  spellCheck={false}
                  value={
                    searchDraft?.patientId === selectedPatient?.id
                      ? (searchDraft?.query ?? '')
                      : ''
                  }
                  onChange={(event) => {
                    if (selectedPatient && !patientsLoading)
                      setSearchDraft({
                        patientId: selectedPatient.id,
                        query: event.target.value,
                      });
                  }}
                  disabled={!selectedPatient || patientsLoading}
                />
                <Button
                  type="submit"
                  variant="ghost"
                  className="overview-search-submit"
                  aria-label="Search selected patient documents"
                  disabled={
                    !selectedPatient ||
                    patientsLoading ||
                    searchDraft?.patientId !== selectedPatient.id ||
                    !searchDraft.query.trim()
                  }
                >
                  <ArrowRight size={18} aria-hidden="true" />
                </Button>
              </form>
              <p id="search-help">
                {selectedPatient
                  ? 'Search this patient’s document names and saved text.'
                  : 'Select a patient to search their documents.'}
              </p>
            </div>
          )}
        <main id="main-content" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <p className="eyebrow">FAMILY MEDICAL VAULT</p>
              <h1 id="page-title" tabIndex={-1}>
                {active.label}
              </h1>
            </div>
            <span className="context-label">
              <span className="context-dot" />
              {selectedPatient?.displayName ?? 'No patient selected'}
            </span>
          </div>
          {uploadNotice &&
            uploadNotice.patientId === selectedPatient?.id &&
            !patientsLoading && (
              <div className="mb-4 space-y-2">
                <p role="status" className="text-sm text-muted-foreground">
                  Documents stored successfully.
                </p>
                {uploadNotice.potentialDuplicate && <DuplicateUploadNotice />}
              </div>
            )}
          {destination === 'overview' ? (
            <>
              <section
                className="welcome-panel"
                aria-labelledby="welcome-title"
              >
                <div className="welcome-copy">
                  <span className="section-kicker">Patient records</span>
                  <h2 id="welcome-title">
                    {selectedPatient
                      ? `Records for ${selectedPatient.displayName}`
                      : 'Choose a patient to get started.'}
                  </h2>
                  {selectedPatient ? (
                    <p>View the documents available for this patient.</p>
                  ) : (
                    <p>
                      Select a patient to bring their medical documents, health
                      trends and medication information into view.
                    </p>
                  )}
                  {selectedPatient ? (
                    <Button className="overview-cta" asChild>
                      <a href="#documents">
                        View documents{' '}
                        <ArrowRight size={18} aria-hidden="true" />
                      </a>
                    </Button>
                  ) : (
                    <Button
                      className="overview-cta"
                      onClick={() => openDialog('patient')}
                    >
                      Select patient
                      <ArrowRight size={18} aria-hidden="true" />
                    </Button>
                  )}
                </div>
                <div className="overview-art" aria-hidden="true">
                  <MedicalDocumentArt />
                </div>
              </section>
              <section
                className="records-section"
                aria-labelledby="records-title"
              >
                <div className="section-heading">
                  <div>
                    <h2 id="records-title">Medical documents</h2>
                    <p>The foundation of a connected health history.</p>
                  </div>
                  <a href="#documents" className="text-link">
                    View documents
                    <ArrowRight size={16} aria-hidden="true" />
                  </a>
                </div>
                <div className="overview-record-icon" aria-hidden="true">
                  <FileText size={28} />
                </div>
              </section>
              <div className="context-note">
                <LockKeyhole size={18} aria-hidden="true" />
                <p>
                  {selectedPatient
                    ? 'Documents are shown for the selected patient.'
                    : 'A separate view for every patient. Select a patient before viewing or adding medical records.'}
                </p>
              </div>
            </>
          ) : destination === 'family-access' ? (
            <FamilyAccessPanel />
          ) : destination === 'documents' &&
            (selectedPatient || patientsLoading) ? (
            <DocumentsPanel
              initialSearch={documentSearch}
              onInitialSearchConsumed={consumeDocumentSearch}
              refreshRevision={listRevision}
              onRequestUpload={() => openDialog('upload')}
            />
          ) : destination === 'trends' ? (
            <TrendsPanel onRequestPatient={() => openDialog('patient')} />
          ) : destination === 'medications' ? (
            <MedicationsPanel onRequestPatient={() => openDialog('patient')} />
          ) : currentState ? (
            <ResourceState
              state="empty"
              title={currentState.title}
              description={
                selectedPatient
                  ? `${active.label} information is not available yet.`
                  : currentState.description
              }
              icon={<active.icon size={28} aria-hidden="true" />}
              {...(!selectedPatient
                ? {
                    actionLabel: 'Select patient',
                    onAction: () => openDialog('patient'),
                  }
                : {})}
              footnote={
                <>
                  <LockKeyhole size={16} aria-hidden="true" />
                  <span>{currentState.note}</span>
                </>
              }
            />
          ) : null}
          <footer className="page-footer">Family Medical Vault</footer>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navigation(true)}
      </nav>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            dialogTrigger.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle ref={dialogTitle} tabIndex={-1}>
              {dialog === 'upload'
                ? selectedPatient || (patientsLoading && uploadStep === 'files')
                  ? 'Upload documents'
                  : 'Select a patient first'
                : 'Select patient'}
            </DialogTitle>
            <DialogDescription>
              {dialog === 'upload'
                ? selectedPatient || (patientsLoading && uploadStep === 'files')
                  ? 'Choose documents for the selected patient.'
                  : 'Medical documents must belong to a patient. Select a patient before uploading.'
                : 'Choose a patient profile available to your account.'}
            </DialogDescription>
          </DialogHeader>
          {dialog === 'patient' ? (
            <PatientPicker onSelected={() => setDialog(null)} />
          ) : dialog === 'upload' &&
            (selectedPatient || (patientsLoading && uploadStep === 'files')) ? (
            <DocumentUploadForm
              onComplete={(allStored, completion) => {
                if (
                  !selectedPatient ||
                  patientsLoading ||
                  completion.patientId !== selectedPatient.id
                )
                  return;
                setListRevision((revision) => revision + 1);
                if (allStored) {
                  setDialog(null);
                  setUploadNotice(completion);
                }
              }}
            />
          ) : (
            <PatientPicker
              onSelected={() => {
                setUploadStep('files');
                focusUploadAfterSelection.current = true;
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
