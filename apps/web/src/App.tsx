import { useEffect, useRef, useState } from 'react';
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
import { FamilyAccessPanel } from './features/access';
import { captureIncomingLink } from './features/access/incoming-link';
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
  const [listRevision, setListRevision] = useState(0);
  const { selectedPatient } = usePatientContext();
  const dialogTrigger = useRef<HTMLElement | null>(null);
  const openDialog = (kind: 'patient' | 'upload') => {
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
      setDestination(readDestination());
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
        aria-label={label}
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
              <span className="control-label">Select patient</span>
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
        <div className="search-strip">
          <div className="search-field">
            <Search size={18} aria-hidden="true" />
            <Input
              aria-label="Search documents"
              aria-describedby="search-help"
              placeholder="Search documents"
              disabled
            />
          </div>
          <p id="search-help">
            {selectedPatient
              ? 'Document search is not available yet.'
              : 'Select a patient to search their documents.'}
          </p>
        </div>
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
          ) : destination === 'documents' && selectedPatient ? (
            <DocumentsPanel
              key={`${selectedPatient.id}:${listRevision}`}
              onRequestUpload={() => openDialog('upload')}
            />
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
            <DialogTitle>
              {dialog === 'upload'
                ? selectedPatient
                  ? 'Upload documents'
                  : 'Select a patient first'
                : 'Select patient'}
            </DialogTitle>
            <DialogDescription>
              {dialog === 'upload'
                ? selectedPatient
                  ? 'Choose documents for the selected patient.'
                  : 'Medical documents must belong to a patient. Select a patient before uploading.'
                : 'Choose a patient profile available to your account.'}
            </DialogDescription>
          </DialogHeader>
          {dialog === 'patient' ? (
            <PatientPicker onSelected={() => setDialog(null)} />
          ) : selectedPatient ? (
            <DocumentUploadForm
              key={selectedPatient.id}
              onComplete={() => setListRevision((revision) => revision + 1)}
            />
          ) : (
            <Button onClick={() => setDialog(null)}>Got it</Button>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
