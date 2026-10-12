import { db } from '../firebase';
import { collection, getDocs, addDoc, doc, setDoc } from 'firebase/firestore';

const DEFAULT_DEPARTMENTS = [
  { id: 'dept1', name: 'Phòng Nông nghiệp' },
  { id: 'dept2', name: 'Phòng Tài nguyên' },
  { id: 'dept3', name: 'Phòng Kinh tế' },
  { id: 'dept4', name: 'Phòng Tài chính' },
  { id: 'dept5', name: 'Phòng Xây dựng' },
];

export async function seedDepartmentsIfEmpty() {
  const deptsCol = collection(db, 'departments');
  const snapshot = await getDocs(deptsCol);
  
  if (snapshot.empty) {
    for (const dept of DEFAULT_DEPARTMENTS) {
      await setDoc(doc(deptsCol, dept.id), dept);
    }
    console.log('Departments seeded successfully');
  }
}
