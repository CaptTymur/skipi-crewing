// UNUSED Linux native-owned namespace allocation. No app/startup/policy calls it.
// A new directory/UUID is never server ownership, entitlement or create authority.
// Caller owns app writers; arbitrary concurrent external/same-UID moves are unsupported.
use super::{Namespace, identity};
use std::{fs::{self, File, OpenOptions, DirBuilder}, io, path::Path};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
// Historical mkdir/metadata facts, not continuing path identity or authority.
pub(crate) struct DirectoryEffect {
    pub created: bool,
    pub identity_confirmed: bool,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct AllocationEffects {
    pub container: DirectoryEffect,
    pub context: DirectoryEffect,
    pub database: DirectoryEffect,
    pub keys: DirectoryEffect,
}
#[derive(Debug)]
pub(crate) struct AllocationError {
    pub code: &'static str,
    pub phase: &'static str,
    pub effects: AllocationEffects,
}
fn error(phase: &'static str, effects: AllocationEffects) -> AllocationError {
    AllocationError { code:"fresh_namespace_unavailable", phase, effects }
}

// Namespace snapshots only: actual DB/key references require their real preparers.
// Deliberately not Clone, Serialize, Debug or a CreationPolicy.
pub(crate) struct FreshNamespaces {
    context: String,
    database: Namespace,
    keys: Namespace,
    effects: AllocationEffects,
}
impl FreshNamespaces {
    pub(crate) fn allocate_application() -> Result<Self, AllocationError> {
        let base=dirs::config_dir().ok_or_else(||error("base_resolution",AllocationEffects::default()))?
            .join("skipi-crewing");
        allocate_at(&base,&uuid::Uuid::new_v4().to_string(),Injection::default())
    }
    pub(crate) fn effects(&self) -> AllocationEffects { self.effects }
    pub(crate) fn into_parts(self) -> (String, Namespace, Namespace) {
        (self.context,self.database,self.keys)
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Role { Base, Container, Context, Database, Keys }
impl Role {
    fn create_phase(self) -> &'static str { match self {
        Self::Base=>"base_create", Self::Container=>"container_create",
        Self::Context=>"context_create", Self::Database=>"database_create", Self::Keys=>"keys_create",
    }}
    fn metadata_phase(self) -> &'static str { match self {
        Self::Base=>"base_admission", Self::Container=>"container_metadata",
        Self::Context=>"context_metadata", Self::Database=>"database_metadata", Self::Keys=>"keys_metadata",
    }}
    fn sync_phase(self) -> &'static str { match self {
        Self::Base=>"base_sync", Self::Container=>"container_sync",
        Self::Context=>"context_sync", Self::Database=>"database_sync", Self::Keys=>"keys_sync",
    }}
}
impl AllocationEffects {
    fn directory_mut(&mut self, role:Role) -> &mut DirectoryEffect { match role {
        Role::Container=>&mut self.container, Role::Context=>&mut self.context,
        Role::Database=>&mut self.database, Role::Keys=>&mut self.keys,
        Role::Base=>unreachable!("base is admitted, never created"),
    }}
}
#[cfg(test)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum Fault { AfterCreate(Role), Sync(Role) }
#[derive(Default)]
struct Injection { #[cfg(test)] fault:Option<Fault> }
impl Injection {
    fn after_create(&self, role:Role) -> bool {
        #[cfg(test)] { return self.fault==Some(Fault::AfterCreate(role)); }
        #[cfg(not(test))] { let _=role; false }
    }
    fn before_sync(&self, role:Role) -> bool {
        #[cfg(test)] { return self.fault==Some(Fault::Sync(role)); }
        #[cfg(not(test))] { let _=role; false }
    }
}
struct Directory { namespace:Namespace, file:File, private:bool }
impl Directory {
    fn admit(path:&Path, private:bool) -> Result<Self,()> {
        let namespace=Namespace::inspect(path).map_err(|_|())?;
        let file=OpenOptions::new().read(true)
            .custom_flags(libc::O_DIRECTORY|libc::O_NOFOLLOW|libc::O_CLOEXEC)
            .open(&namespace.root).map_err(|_|())?;
        let directory=Self {namespace,file,private};
        directory.verify()?;
        Ok(directory)
    }
    fn verify(&self) -> Result<(),()> {
        self.namespace.verify().map_err(|_|())?;
        let path=fs::symlink_metadata(&self.namespace.root).map_err(|_|())?;
        let fd=self.file.metadata().map_err(|_|())?;
        if !path.is_dir() || path.file_type().is_symlink() || !fd.is_dir()
            || identity(&path)!=self.namespace.root_identity
            || identity(&fd)!=self.namespace.root_identity
            || (self.private && (path.mode() & 0o7777!=0o700 || fd.mode() & 0o7777!=0o700)) {
            return Err(());
        }
        Ok(())
    }
    fn sync(&self, role:Role, injection:&Injection, effects:AllocationEffects)
        -> Result<(),AllocationError> {
        self.verify().map_err(|_|error(role.sync_phase(),effects))?;
        if injection.before_sync(role) { return Err(error(role.sync_phase(),effects)); }
        self.file.sync_all().map_err(|_|error(role.sync_phase(),effects))?;
        self.verify().map_err(|_|error(role.sync_phase(),effects))
    }
}
fn create_directory(parent:&Directory, name:&str, role:Role, admit_existing:bool,
    injection:&Injection, effects:&mut AllocationEffects) -> Result<Directory,AllocationError> {
    parent.verify().map_err(|_|error(role.create_phase(),*effects))?;
    let path=parent.namespace.root.join(name);
    match DirBuilder::new().mode(0o700).create(&path) {
        Ok(()) => {
            effects.directory_mut(role).created=true;
            // If metadata/open fails, creation is known but identity remains UNKNOWN.
            if injection.after_create(role) { return Err(error(role.metadata_phase(),*effects)); }
        },
        Err(e) if admit_existing && e.kind()==io::ErrorKind::AlreadyExists => (),
        Err(_) => return Err(error(role.create_phase(),*effects)),
    }
    let directory=Directory::admit(&path,true).map_err(|_|error(role.metadata_phase(),*effects))?;
    effects.directory_mut(role).identity_confirmed=true;
    parent.verify().map_err(|_|error(role.metadata_phase(),*effects))?;
    Ok(directory)
}
fn allocate_at(base:&Path, context:&str, injection:Injection) -> Result<FreshNamespaces,AllocationError> {
    let mut effects=AllocationEffects::default();
    // Native code supplies this UUID; deterministic fixture adapter tests its boundary.
    let parsed=uuid::Uuid::parse_str(context).map_err(|_|error("context_id",effects))?;
    if parsed.get_version_num()!=4 || parsed.get_variant()!=uuid::Variant::RFC4122 || parsed.to_string()!=context {
        return Err(error("context_id",effects));
    }
    let base=Directory::admit(base,false).map_err(|_|error(Role::Base.metadata_phase(),effects))?;
    let container=create_directory(&base,"native-contexts",Role::Container,true,&injection,&mut effects)?;
    // Keep both FDs alive through the relevant directory sync. No ancestor mkdir.
    if effects.container.created { base.sync(Role::Base,&injection,effects)?; }
    base.verify().map_err(|_|error("base_changed",effects))?;
    let context_dir=create_directory(&container,context,Role::Context,false,&injection,&mut effects)?;
    container.verify().map_err(|_|error("container_changed",effects))?;
    let database=create_directory(&context_dir,"database",Role::Database,false,&injection,&mut effects)?;
    base.verify().map_err(|_|error("base_changed",effects))?;
    container.verify().map_err(|_|error("container_changed",effects))?;
    let keys=create_directory(&context_dir,"keys",Role::Keys,false,&injection,&mut effects)?;
    for (directory,role) in [(&database,Role::Database),(&keys,Role::Keys),
        (&context_dir,Role::Context),(&container,Role::Container)] {
        base.verify().map_err(|_|error("base_changed",effects))?;
        container.verify().map_err(|_|error("container_changed",effects))?;
        context_dir.verify().map_err(|_|error("context_changed",effects))?;
        directory.sync(role,&injection,effects)?;
    }
    for directory in [&base,&container,&context_dir,&database,&keys] {
        directory.verify().map_err(|_|error("final_identity",effects))?;
    }
    Ok(FreshNamespaces {context:context.to_owned(),database:database.namespace,keys:keys.namespace,effects})
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::{Store, Owner, native_keys, native_binding::Binding};
    use std::{path::PathBuf, sync::Mutex};
    use std::os::unix::fs::{PermissionsExt, symlink};
    const CONTEXT:&str="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    struct Fixture {root:PathBuf, base:PathBuf}
    impl Fixture {
        fn new() -> Self {
            let root=std::env::temp_dir().join(format!("crewing635-fresh-{}",uuid::Uuid::new_v4()));
            DirBuilder::new().mode(0o700).create(&root).unwrap();
            let base=root.join("application");
            DirBuilder::new().mode(0o700).create(&base).unwrap();
            Self {root,base}
        }
        fn allocate(&self, fault:Option<Fault>) -> Result<FreshNamespaces,AllocationError> {
            allocate_at(&self.base,CONTEXT,Injection {fault})
        }
        fn paths(&self) -> [PathBuf;4] {
            let container=self.base.join("native-contexts"); let context=container.join(CONTEXT);
            [container,context.clone(),context.join("database"),context.join("keys")]
        }
        fn assert_artifacts(&self, effects:AllocationEffects) {
            for (p,fact) in self.paths().iter().zip([effects.container,effects.context,effects.database,effects.keys]) {
                assert_eq!(p.exists(),fact.created,"owned fixture starts with no container");
                if fact.created { assert_eq!(fs::symlink_metadata(p).unwrap().mode()&0o7777,0o700); }
            }
            // Allocation has no SQLite, key material, settings or pending files.
            for path in [self.paths()[2].join("crewing.sqlite"),
                self.paths()[3].join(crate::messaging::SK_FILENAME),self.base.join("settings.json")] {
                assert!(!path.exists());
            }
        }
    }
    impl Drop for Fixture {fn drop(&mut self) { fs::remove_dir_all(&self.root).unwrap(); }}
    fn failure(result:Result<FreshNamespaces,AllocationError>) -> AllocationError {
        match result {Err(error)=>error,Ok(_)=>panic!("allocation should be unusable")}
    }

    #[test]
    fn native635_fresh_namespace_success_prepares_real_database_key_and_binding() {
        let f=Fixture::new();
        let allocation=f.allocate(None).unwrap();
        assert_eq!(allocation.effects(),AllocationEffects {
            container:DirectoryEffect {created:true,identity_confirmed:true},
            context:DirectoryEffect {created:true,identity_confirmed:true},
            database:DirectoryEffect {created:true,identity_confirmed:true},
            keys:DirectoryEffect {created:true,identity_confirmed:true},
        });
        let (context,db_namespace,key_namespace)=allocation.into_parts();
        assert_eq!(context,CONTEXT);
        for path in f.paths() {assert_eq!(fs::symlink_metadata(path).unwrap().mode()&0o7777,0o700);}
        assert!(fs::read_dir(&db_namespace.root).unwrap().next().is_none());
        assert!(fs::read_dir(&key_namespace.root).unwrap().next().is_none());
        assert_ne!(db_namespace.root,key_namespace.root);
        let owner=Owner::from_validated_binding("owned-account".into(),"owned-company".into(),context.clone()).unwrap();
        let slot=Mutex::new(None); let quarantine=Mutex::new(None); let store=Store::new(&slot,&quarantine);
        let prepared=store.prepare_fresh(db_namespace,owner.clone()).unwrap();
        let key=native_keys::prepare_fresh(&key_namespace,owner).unwrap();
        let binding=Binding::from_references(context,prepared.reference(),key.reference()).unwrap();
        assert!(binding.matches_prepared(&prepared.reference(),&key.reference()));
        prepared.validate_before_persist().unwrap(); key.validate_live().unwrap();
        // Preparation-only fixture: no Settings commit or private activation.
        drop(prepared); key.validate_live().unwrap();
        store.close_all().unwrap();
        assert!(slot.lock().unwrap().is_none() && quarantine.lock().unwrap().is_none());
    }
    #[test]
    fn native635_fresh_namespace_collision_preserves_existing_tree_and_unrelated_children() {
        let f=Fixture::new(); let paths=f.paths();
        fs::create_dir(&paths[0]).unwrap(); fs::set_permissions(&paths[0],fs::Permissions::from_mode(0o700)).unwrap();
        fs::create_dir(&paths[1]).unwrap(); fs::set_permissions(&paths[1],fs::Permissions::from_mode(0o700)).unwrap();
        let sentinel=paths[1].join("sentinel"); fs::write(&sentinel,b"existing context").unwrap();
        let other=paths[0].join("unrelated"); fs::write(&other,b"keep").unwrap();
        let inode=fs::metadata(&sentinel).unwrap().ino();
        let e=failure(f.allocate(None));
        assert_eq!(e.phase,"context_create");
        assert_eq!(e.effects.container,DirectoryEffect {created:false,identity_confirmed:true});
        assert_eq!(e.effects.context,DirectoryEffect::default());
        assert_eq!(fs::read(&sentinel).unwrap(),b"existing context");
        assert_eq!(fs::metadata(&sentinel).unwrap().ino(),inode);
        assert_eq!(fs::read(other).unwrap(),b"keep");
        assert!(!paths[2].exists() && !paths[3].exists());
        assert_eq!(fs::read_dir(&paths[1]).unwrap().count(),1);
    }
    #[test]
    fn native635_fresh_namespace_existing_private_container_is_read_only_and_not_adopted() {
        let f=Fixture::new(); let container=f.paths()[0].clone();
        DirBuilder::new().mode(0o700).create(&container).unwrap();
        let sentinel=container.join("unrelated"); fs::write(&sentinel,b"existing").unwrap();
        let inode=fs::metadata(&container).unwrap().ino(); let file_inode=fs::metadata(&sentinel).unwrap().ino();
        let allocation=f.allocate(None).unwrap();
        assert_eq!(allocation.effects().container,DirectoryEffect {created:false,identity_confirmed:true});
        assert_eq!(fs::metadata(&container).unwrap().ino(),inode);
        assert_eq!(fs::metadata(&sentinel).unwrap().ino(),file_inode);
        assert_eq!(fs::read(sentinel).unwrap(),b"existing");
        let (_,db,key)=allocation.into_parts(); db.verify().unwrap(); key.verify().unwrap();
    }
    #[test]
    fn native635_fresh_namespace_symlink_file_and_unsafe_mode_never_adopt_or_chmod() {
        for variant in 0..4 {
            let f=Fixture::new(); let container=f.paths()[0].clone();
            let target=f.root.join("target");
            DirBuilder::new().mode(0o700).create(&target).unwrap();
            let sentinel=target.join("sentinel"); fs::write(&sentinel,b"untouched").unwrap();
            let inode=fs::metadata(&sentinel).unwrap().ino();
            match variant {
                0=>symlink(&target,&container).unwrap(),
                1=>fs::write(&container,b"ordinary file").unwrap(),
                2=>{DirBuilder::new().mode(0o700).create(&container).unwrap();
                    fs::set_permissions(&container,fs::Permissions::from_mode(0o755)).unwrap();},
                _=>fs::set_permissions(&f.base,fs::Permissions::from_mode(0o770)).unwrap(),
            }
            let e=failure(f.allocate(None));
            assert_eq!(e.effects,AllocationEffects::default());
            assert_eq!(fs::read(&sentinel).unwrap(),b"untouched");
            assert_eq!(fs::metadata(&sentinel).unwrap().ino(),inode);
            match variant {
                0=>assert!(fs::symlink_metadata(&container).unwrap().file_type().is_symlink()),
                1=>assert_eq!(fs::read(&container).unwrap(),b"ordinary file"),
                2=>assert_eq!(fs::metadata(&container).unwrap().mode()&0o777,0o755),
                _=>assert_eq!(fs::metadata(&f.base).unwrap().mode()&0o777,0o770),
            }
            assert!(!target.join(CONTEXT).exists());
        }
    }
    #[test]
    fn native635_fresh_namespace_invalid_context_never_writes() {
        for context in ["not-uuid","../escape","aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa",
            "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA","aaaaaaaa-aaaa-4aaa-caaa-aaaaaaaaaaaa"] {
            let f=Fixture::new();
            let e=failure(allocate_at(&f.base,context,Injection::default()));
            assert_eq!(e.phase,"context_id"); assert_eq!(e.effects,AllocationEffects::default());
            assert!(fs::read_dir(&f.base).unwrap().next().is_none());
        }
    }
    #[test]
    fn native635_fresh_namespace_after_mkdir_error_reports_created_identity_unknown_and_retains_artifacts() {
        for (index,role) in [Role::Container,Role::Context,Role::Database,Role::Keys].into_iter().enumerate() {
            let f=Fixture::new(); let e=failure(f.allocate(Some(Fault::AfterCreate(role))));
            assert_eq!(e.code,"fresh_namespace_unavailable"); assert_eq!(e.phase,role.metadata_phase());
            for (i,fact) in [e.effects.container,e.effects.context,e.effects.database,e.effects.keys].into_iter().enumerate() {
                assert_eq!(fact.created,i<=index);
                assert_eq!(fact.identity_confirmed,i<index);
            }
            f.assert_artifacts(e.effects);
        }
    }
    #[test]
    fn native635_fresh_namespace_sync_error_is_unusable_with_honest_retained_artifacts() {
        for role in [Role::Base,Role::Database,Role::Keys,Role::Context,Role::Container] {
            let f=Fixture::new(); let e=failure(f.allocate(Some(Fault::Sync(role))));
            assert_eq!(e.phase,role.sync_phase());
            let count=if role==Role::Base {1}else{4};
            for (i,fact) in [e.effects.container,e.effects.context,e.effects.database,e.effects.keys].into_iter().enumerate() {
                assert_eq!(fact.created,i<count); assert_eq!(fact.identity_confirmed,i<count);
            }
            f.assert_artifacts(e.effects);
        }
    }
    #[test]
    fn native635_fresh_namespace_replaced_snapshot_is_rejected_by_real_preparer() {
        let f=Fixture::new(); let (context,db,key)=f.allocate(None).unwrap().into_parts();
        let path=db.root.clone(); let original=path.with_file_name("original-database");
        fs::rename(&path,&original).unwrap(); DirBuilder::new().mode(0o700).create(&path).unwrap();
        let slot=Mutex::new(None); let quarantine=Mutex::new(None); let store=Store::new(&slot,&quarantine);
        let owner=Owner::from_validated_binding("owned-account".into(),"owned-company".into(),context).unwrap();
        assert!(matches!(store.prepare_fresh(db,owner),Err(super::super::Error::IdentityMismatch)));
        assert!(fs::read_dir(&path).unwrap().next().is_none());
        assert!(fs::read_dir(&original).unwrap().next().is_none());
        key.verify().unwrap();
        assert!(slot.lock().unwrap().is_none() && quarantine.lock().unwrap().is_none());
    }
}
